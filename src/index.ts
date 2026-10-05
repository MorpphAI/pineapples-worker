import { fromHono } from "chanfana";
import { Hono } from "hono";
import { Env } from "./types/configTypes";
import { pineapplesRouter } from "./controllers/router";
import { authMiddleware } from "./middleware/auth";
import { AccommodationSyncError, SyncAccommodationsService } from "./services/v1/accommodation/syncAccommodationsService";
import { AvantioApiGateway } from "./apiGateways/avantio/getAppointments";

const app = new Hono<{ Bindings: Env }>();

app.use("*", authMiddleware);

const openapi = fromHono(app, {
	docs_url: "/", 
	schema: {
		info: {
			title: "Pineapple de limpeza para acomodações",
			version: "1.0.0",
			description: "API para sincronizar check-ins/outs e montar escala de limpeza.",
		},
	},
});

openapi.route("/", pineapplesRouter);

const DIAGNOSTIC_PATH = "/_diagnostics/avantio-sample-20261005";
const DIAGNOSTIC_PUBLIC_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtl106WrdorDEMH05kQxOQH/fUUHzM3R4e1BylfGw8pWs2I9K9NQBn5RB+dLALQIQHXDRHbThVy6MMTarvo+EDRug0zosG8FmWxte/i5mnoRwOJThFUuh2EuUeXZw1WOquqJEsO/wBZ7nqGFLsT8117lnDr1copPn6xqtAE+e4+GqZIzL2S3RTJWtVro0GqPiJOAI8bpNWo7hrg+7AmRjAFOBOwWu/KtgW/s5CPszkb0rc6+cdAjt8FIQWkTnvtYNAE5liARDMqIcyLTNXL1Xs2LE7U4Lr1zHNNBCW2PuaP2gjPxMbxWA5Amv+9rTip4zUCxOJZeCCcY8+HDiQX84YQIDAQAB";

function fromBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
	}
	return btoa(binary);
}

async function gzip(value: string): Promise<Uint8Array> {
	const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encryptDiagnosticPayload(payload: unknown): Promise<Record<string, string>> {
	const publicKey = await crypto.subtle.importKey(
		"spki",
		fromBase64(DIAGNOSTIC_PUBLIC_KEY),
		{ name: "RSA-OAEP", hash: "SHA-256" },
		false,
		["encrypt"],
	);
	const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
	const rawAesKey = new Uint8Array(await crypto.subtle.exportKey("raw", aesKey));
	const encryptedKey = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawAesKey));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const plaintext = await gzip(JSON.stringify(payload));
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext));
	return {
		alg: "RSA-OAEP-SHA256+A256GCM",
		encoding: "gzip",
		iv: toBase64(iv),
		encrypted_key: toBase64(encryptedKey),
		ciphertext: toBase64(ciphertext),
	};
}


type DiagnosticShapeEntry = {
	path: string;
	type: "object" | "array" | "string" | "number" | "boolean" | "null";
	keys?: string[];
	length?: number;
	safe_value?: string;
};

const SAFE_DIAGNOSTIC_VALUE_KEYS = new Set([
	"type", "status", "purpose", "pricingModel", "addrType", "countryCode", "managedBy",
	"accessType", "displayMode", "rule", "paymentType", "unit",
]);

function diagnosticShape(value: unknown, path = "$", out: DiagnosticShapeEntry[] = []): DiagnosticShapeEntry[] {
	if (value === null) {
		out.push({ path, type: "null" });
		return out;
	}
	if (Array.isArray(value)) {
		out.push({ path, type: "array", length: value.length });
		if (value.length > 0) diagnosticShape(value[0], `${path}[0]`, out);
		return out;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		out.push({ path, type: "object", keys });
		for (const key of keys) diagnosticShape(record[key], `${path}.${key}`, out);
		return out;
	}
	if (typeof value === "string") {
		const key = path.split(".").pop()?.replace(/\[\d+\]$/, "") ?? "";
		out.push({
			path,
			type: "string",
			...(SAFE_DIAGNOSTIC_VALUE_KEYS.has(key) ? { safe_value: value } : {}),
		});
		return out;
	}
	if (typeof value === "number") {
		out.push({ path, type: "number" });
		return out;
	}
	if (typeof value === "boolean") {
		out.push({ path, type: "boolean" });
		return out;
	}
	return out;
}

async function avantioDiagnosticSample(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const slotValue = Number(url.searchParams.get("slot") ?? "0");
	const slot = Number.isInteger(slotValue) && slotValue >= 0 && slotValue <= 2 ? slotValue : 0;

	try {
		const row = await env.DB.prepare(
			"SELECT accommodation_id FROM accommodations WHERE accommodation_id IS NOT NULL AND LENGTH(TRIM(accommodation_id)) > 0 ORDER BY updated_at DESC, accommodation_id ASC LIMIT 1 OFFSET ?"
		).bind(slot).first<{ accommodation_id: string }>();
		if (!row?.accommodation_id) {
			return Response.json({ success: false, error: "diagnostic_sample_not_found" }, { status: 404 });
		}

		const detail = await new AvantioApiGateway(env).getAccommodationStrict(row.accommodation_id);
		const encrypted = await encryptDiagnosticPayload({
			slot,
			accommodation_id: row.accommodation_id,
			detail,
		});
		return Response.json({
			success: true,
			slot,
			shape: diagnosticShape(detail),
			...encrypted,
		});
	} catch (error) {
		console.error("[AvantioDiagnostic] diagnostic_sample_failed");
		return Response.json({
			success: false,
			error: error instanceof Error ? error.name : "diagnostic_sample_failed",
		}, { status: 500 });
	}
}

export async function runScheduledAccommodationIndexBatch(env: Env): Promise<void> {
	try {
		const result = await new SyncAccommodationsService(env).sync();
		const code = result.complete ? "generation_complete" : "batch_processed";
		console.log(`[AccommodationIndexScheduled] stage=sync code=${code} synced=${result.synced} processed_records=${result.processed_records} processed_pages=${result.processed_pages}`);
	} catch (error) {
		const code = error instanceof AccommodationSyncError ? error.code : "accommodation_index_batch_failed";
		console.error(`[AccommodationIndexScheduled] stage=sync code=${code}`);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		if (new URL(request.url).pathname === DIAGNOSTIC_PATH) return avantioDiagnosticSample(request, env);
		return app.fetch(request, env, ctx);
	},
	scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(runScheduledAccommodationIndexBatch(env));
	},
};

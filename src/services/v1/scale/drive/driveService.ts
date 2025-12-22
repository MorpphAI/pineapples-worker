import { Env } from "../../../../types/configTypes";

export interface DriveUploadResponse {
    status: "success" | "error";
    message: string;
    fileId?: string;
    fileUrl?: string;
}

export class DriveService {
    private scriptUrl: string;

    constructor(env: Env) {
        this.scriptUrl = env.GOOGLE_SCRIPT_URL;
    }
    
    async uploadFile(fileName: string, fileBase64: string): Promise<DriveUploadResponse> {
        if (!this.scriptUrl) {
            console.warn("[DriveService] URL do Google Script não configurada.");
            return { status: "error", message: "Configuração ausente: GOOGLE_SCRIPT_URL" };
        }

        console.log(`[DriveService] Enviando arquivo ${fileName} para o Drive...`);

        try {
            const response = await fetch(this.scriptUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    fileName: fileName,
                    fileBase64: fileBase64,
                })
            });

            const resultText = await response.text();

            let result: DriveUploadResponse;
            try {
                result = JSON.parse(resultText);
            } catch {
                console.error("[DriveService] Resposta não-JSON do Google:", resultText);
                return { status: "error", message: "Erro na resposta do Google Script" };
            }

            if (result.status === "success") {
                console.log(`[DriveService] Sucesso! Arquivo salvo. ID: ${result.fileId}`);
            } else {
                console.error(`[DriveService] Falha: ${result.message}`);
            }

            return result;

        } catch (error: any) {
            console.error("[DriveService] Erro de rede:", error);
            return { status: "error", message: error.message || "Erro desconhecido no upload" };
        }
    }
}
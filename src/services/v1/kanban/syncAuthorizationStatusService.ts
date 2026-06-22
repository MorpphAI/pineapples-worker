import { AvantioApiGateway } from "../../../apiGateways/avantio/getAppointments";
import { classifyCleaningRequirement, isSameDayTurnover } from "../../../domain/scale/bookingClassification";
import {
  AuthorizationSyncRpcResult,
  AuthorizationSyncStatus,
  SupabaseKanbanRepository,
} from "../../../repositories/kanban/supabaseKanbanRepository";
import { AvantioBooking } from "../../../types/avantioTypes";
import { Env } from "../../../types/configTypes";
import { isValidBookingStatus } from "../../../utils/scaleUtils";

const AUTHORIZATION_SOURCE = "avantio-status-sync";

export type SyncAuthorizationStatusResult = {
  success: boolean;
  date: string;
  summary: {
    rawCheckins: number;
    rawCheckouts: number;
    validCheckins: number;
    validCheckouts: number;
    candidates: number;
    updated: number;
    unchanged: number;
    skipped: number;
    manualSkipped: number;
    errors: number;
  };
  results: Array<{
    accommodationId: string;
    propertyCode?: string | null;
    computedStatus: AuthorizationSyncStatus;
    rpcStatus: string;
    reason?: string;
    cardId?: string;
    previousStatus?: string | null;
    newStatus?: string | null;
    error?: string;
  }>;
};

type AvantioAuthorizationGateway = Pick<AvantioApiGateway, "getCheckins" | "getCheckouts">;
type KanbanAuthorizationRepository = Pick<SupabaseKanbanRepository, "syncAuthorization">;

export class SyncAuthorizationStatusService {
  private readonly avantioApiGateway: AvantioAuthorizationGateway;
  private readonly kanbanRepository: KanbanAuthorizationRepository;

  constructor(
    env: Env,
    avantioApiGateway: AvantioAuthorizationGateway = new AvantioApiGateway(env),
    kanbanRepository: KanbanAuthorizationRepository = new SupabaseKanbanRepository(env),
  ) {
    this.avantioApiGateway = avantioApiGateway;
    this.kanbanRepository = kanbanRepository;
  }

  async sync(date: string): Promise<SyncAuthorizationStatusResult> {
    const [rawCheckins, rawCheckouts] = await Promise.all([
      this.avantioApiGateway.getCheckins(date),
      this.avantioApiGateway.getCheckouts(date),
    ]);

    const validCheckins = rawCheckins.filter((booking) => isValidBookingStatus(booking.status));
    const validCheckouts = rawCheckouts.filter((booking) => isValidBookingStatus(booking.status));
    const checkinsByAccommodation = this.groupByAccommodation(validCheckins);

    const result: SyncAuthorizationStatusResult = {
      success: true,
      date,
      summary: {
        rawCheckins: rawCheckins.length,
        rawCheckouts: rawCheckouts.length,
        validCheckins: validCheckins.length,
        validCheckouts: validCheckouts.length,
        candidates: validCheckouts.length,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        manualSkipped: 0,
        errors: 0,
      },
      results: [],
    };

    for (const bookingOut of validCheckouts) {
      const bookingIn = checkinsByAccommodation.get(bookingOut.accommodationId)?.[0] ?? null;
      const classification = classifyCleaningRequirement(bookingOut, bookingIn);
      const computedStatus: AuthorizationSyncStatus = isSameDayTurnover(classification) ? "tim" : "out";
      const propertyCode = this.getPropertyCode(bookingOut);
      const payload = {
        date,
        accommodation_id: bookingOut.accommodationId,
        booking_out_id: bookingOut.id,
        booking_in_id: bookingIn?.id ?? null,
        booking_out_reference: bookingOut.reference ?? null,
        booking_in_reference: bookingIn?.reference ?? null,
        booking_out_status: bookingOut.status,
        booking_in_status: bookingIn?.status ?? null,
        classification,
        detected_at: new Date().toISOString(),
        source: AUTHORIZATION_SOURCE,
      };

      try {
        const rpcResult = await this.kanbanRepository.syncAuthorization({
          accommodationId: bookingOut.accommodationId,
          propertyCode,
          targetDate: date,
          authorizationStatus: computedStatus,
          payload,
        });

        this.countRpcResult(result, rpcResult);
        result.results.push({
          accommodationId: bookingOut.accommodationId,
          propertyCode,
          computedStatus,
          rpcStatus: rpcResult.status,
          reason: rpcResult.reason,
          cardId: rpcResult.card_id,
          previousStatus: rpcResult.previous_status,
          newStatus: rpcResult.new_status,
        });
      } catch (error: any) {
        result.summary.errors += 1;
        result.results.push({
          accommodationId: bookingOut.accommodationId,
          propertyCode,
          computedStatus,
          rpcStatus: "error",
          error: error?.message ?? String(error),
        });
      }
    }

    result.success = result.summary.errors === 0;
    return result;
  }

  private groupByAccommodation(bookings: AvantioBooking[]): Map<string, AvantioBooking[]> {
    const grouped = new Map<string, AvantioBooking[]>();

    for (const booking of bookings) {
      const existing = grouped.get(booking.accommodationId) ?? [];
      existing.push(booking);
      grouped.set(booking.accommodationId, existing);
    }

    return grouped;
  }

  private getPropertyCode(bookingOut: AvantioBooking): string | null {
    return bookingOut.externalData?.reference ?? bookingOut.reference ?? bookingOut.id1 ?? null;
  }

  private countRpcResult(result: SyncAuthorizationStatusResult, rpcResult: AuthorizationSyncRpcResult): void {
    if (rpcResult.status === "updated") {
      result.summary.updated += 1;
      return;
    }

    if (rpcResult.status === "unchanged") {
      result.summary.unchanged += 1;
      return;
    }

    if (rpcResult.status === "skipped") {
      result.summary.skipped += 1;
      if (this.isManualSkip(rpcResult.reason)) {
        result.summary.manualSkipped += 1;
      }
      return;
    }

    result.summary.errors += 1;
  }

  private isManualSkip(reason?: string): boolean {
    return reason === "late" || reason === "leite" || reason === "manual_late" || reason === "manual";
  }
}

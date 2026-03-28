import { describe, it, expect } from "vitest";
import {
    calculateCleaningEffort,
    haversineDistanceKm,
    travelMinutesByDistance,
} from "../../src/utils/scaleUtils";

describe("calculateCleaningEffort — comportamento base (regressão)", () => {
    it("área < 40: 1 pessoa, 60 min", () => {
        expect(calculateCleaningEffort(30)).toEqual({ teamSize: 1, estimatedMinutes: 60 });
    });
    it("área 40-69: 1 pessoa, 90 min", () => {
        expect(calculateCleaningEffort(50)).toEqual({ teamSize: 1, estimatedMinutes: 90 });
    });
    it("área 70-89: 2 pessoas, 120 min", () => {
        expect(calculateCleaningEffort(80)).toEqual({ teamSize: 2, estimatedMinutes: 120 });
    });
    it("área 90-119: 2 pessoas, 150 min", () => {
        expect(calculateCleaningEffort(100)).toEqual({ teamSize: 2, estimatedMinutes: 150 });
    });
    it("área >= 120: 2 pessoas, 180 min", () => {
        expect(calculateCleaningEffort(130)).toEqual({ teamSize: 2, estimatedMinutes: 180 });
    });
});

describe("calculateCleaningEffort — stayDuration sem acréscimo (≤ 4 dias)", () => {
    it("stayDuration = 0: sem acréscimo", () => {
        expect(calculateCleaningEffort(50, 0)).toEqual({ teamSize: 1, estimatedMinutes: 90 });
    });
    it("stayDuration = 4: sem acréscimo", () => {
        expect(calculateCleaningEffort(50, 4)).toEqual({ teamSize: 1, estimatedMinutes: 90 });
    });
    it("stayDuration = null: sem acréscimo", () => {
        expect(calculateCleaningEffort(50, null)).toEqual({ teamSize: 1, estimatedMinutes: 90 });
    });
    it("stayDuration = undefined: sem acréscimo", () => {
        expect(calculateCleaningEffort(50, undefined)).toEqual({ teamSize: 1, estimatedMinutes: 90 });
    });
});

describe("calculateCleaningEffort — stayDuration 5-8 dias (+30 min)", () => {
    it("stayDuration = 5, área 50m²: 90 + 30 = 120 min", () => {
        expect(calculateCleaningEffort(50, 5)).toEqual({ teamSize: 1, estimatedMinutes: 120 });
    });
    it("stayDuration = 8, área 80m²: 120 + 30 = 150 min", () => {
        expect(calculateCleaningEffort(80, 8)).toEqual({ teamSize: 2, estimatedMinutes: 150 });
    });
});

describe("calculateCleaningEffort — stayDuration 9-12 dias (+60 min)", () => {
    it("stayDuration = 9, área 50m²: 90 + 60 = 150 min", () => {
        expect(calculateCleaningEffort(50, 9)).toEqual({ teamSize: 1, estimatedMinutes: 150 });
    });
    it("stayDuration = 12, área 80m²: 120 + 60 = 180 min", () => {
        expect(calculateCleaningEffort(80, 12)).toEqual({ teamSize: 2, estimatedMinutes: 180 });
    });
});

describe("calculateCleaningEffort — teamSize = 3 (stayDuration > 7 e área >= 90)", () => {
    it("stayDuration = 8, área = 90: teamSize = 3", () => {
        expect(calculateCleaningEffort(90, 8).teamSize).toBe(3);
    });
    it("stayDuration = 10, área = 100: teamSize = 3", () => {
        expect(calculateCleaningEffort(100, 10).teamSize).toBe(3);
    });
    it("stayDuration = 8, área = 89: teamSize permanece 2 (área insuficiente)", () => {
        expect(calculateCleaningEffort(89, 8).teamSize).toBe(2);
    });
    it("stayDuration = 7, área = 100: teamSize NÃO é 3 (limiar é > 7, não >= 7)", () => {
        expect(calculateCleaningEffort(100, 7).teamSize).toBe(2);
    });
});

describe("haversineDistanceKm", () => {
    it("mesma coordenada retorna 0", () => {
        expect(haversineDistanceKm(-23.5, -46.6, -23.5, -46.6)).toBe(0);
    });
    it("São Paulo ↔ Rio (~357 km)", () => {
        const dist = haversineDistanceKm(-23.5505, -46.6333, -22.9068, -43.1729);
        expect(dist).toBeGreaterThan(350);
        expect(dist).toBeLessThan(365);
    });
    it("distância é simétrica", () => {
        const d1 = haversineDistanceKm(-23.5, -46.6, -22.9, -43.1);
        const d2 = haversineDistanceKm(-22.9, -43.1, -23.5, -46.6);
        expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
    });
});

describe("travelMinutesByDistance", () => {
    // A fórmula é: ceil(5 + distKm/15*60)
    // O 5 é overhead fixo de deslocamento (não um mínimo, é sempre somado)
    it("distância 0: ceil(5 + 0) = 5 min", () => {
        expect(travelMinutesByDistance(0)).toBe(5);
    });
    it("distância 0.5 km: ceil(5 + 2) = 7 min", () => {
        expect(travelMinutesByDistance(0.5)).toBe(7);
    });
    it("distância 7.5 km: ceil(5 + 30) = 35 min", () => {
        expect(travelMinutesByDistance(7.5)).toBe(35);
    });
    it("distância 15 km: ceil(5 + 60) = 65 min", () => {
        expect(travelMinutesByDistance(15)).toBe(65);
    });
});

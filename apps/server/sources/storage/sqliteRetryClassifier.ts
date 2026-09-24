import { isPrismaErrorCode } from "@/storage/prisma";

function readErrorMessage(error: unknown): string {
    if (error instanceof Error && typeof error.message === "string") return error.message;
    if (error && typeof error === "object" && "message" in error) {
        const value = (error as { message?: unknown }).message;
        if (typeof value === "string") return value;
    }
    return "";
}

export function isRetryableSqliteWriteError(error: unknown): boolean {
    if (isPrismaErrorCode(error, "SQLITE_BUSY")) return true;
    if (isPrismaErrorCode(error, "P1008")) return true;
    if (isPrismaErrorCode(error, "P2024")) return true;
    if (isPrismaErrorCode(error, "P2028")) return true;

    const message = readErrorMessage(error).toLowerCase();
    if (message.includes("socket timeout")) return true;
    if (message.includes("database failed to respond")) return true;
    if (message.includes("database is locked")) return true;
    if (message.includes("sqlite_busy")) return true;
    return false;
}

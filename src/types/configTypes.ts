export interface Env {
	AVANTIO_API_KEY: string;
  AVANTIO_BASE_URL: string;
  GOOGLE_SCRIPT_URL: string; 
  DB: D1Database;
}

export interface DriveUploadResponse {
    status: "success" | "error";
    message: string;
    fileId?: string;
    fileUrl?: string;
}

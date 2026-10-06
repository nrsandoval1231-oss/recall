import { File, UploadType } from "expo-file-system";
import { NetworkError } from "@recall/api-client";
import type { FileUploader } from "@recall/sync";
import type { ExpoFiles } from "./expo-files";

/** Streams the file from disk (never loads it into JS memory). Any HTTP response is returned; only transport failure throws. */
export class ExpoFileUploader implements FileUploader {
  constructor(private readonly files: ExpoFiles) {}

  async putFile(request: { url: string; headers: Record<string, string> }, fileRel: string) {
    try {
      const result = await new File(this.files.absoluteUri(fileRel)).upload(request.url, {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        headers: request.headers,
        sessionType: "foreground",
      });
      return { status: result.status, bodyText: result.body };
    } catch (cause) {
      throw new NetworkError("The upload was interrupted.", { cause });
    }
  }
}

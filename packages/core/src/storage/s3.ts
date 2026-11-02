import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ObjectStorage {
  presignUpload(
    key: string,
    contentType: string,
    size: number,
  ): Promise<string>;
  presignDownload(
    key: string,
    filename: string,
    mimeType: string,
    inline: boolean,
  ): Promise<string>;
  stat(key: string): Promise<{ size: number; contentType?: string }>;
  // Server-side copy within the bucket, keeping content type and metadata.
  copy(sourceKey: string, destinationKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function s3Storage(client: S3Client, bucket: string): ObjectStorage {
  return {
    presignUpload: (Key, ContentType, ContentLength) =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key,
          ContentType,
          ContentLength,
          IfNoneMatch: "*",
        }),
        { expiresIn: 300 },
      ),
    presignDownload: (Key, filename, mimeType, inline) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key,
          ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
          ResponseContentType: inline ? mimeType : "application/octet-stream",
        }),
        { expiresIn: 60 },
      ),
    stat: async (Key) => {
      const result = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key }),
      );
      return {
        size: result.ContentLength ?? 0,
        contentType: result.ContentType,
      };
    },
    copy: async (sourceKey, Key) => {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key,
          CopySource: `${bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`,
        }),
      );
    },
    delete: async (Key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    },
  };
}

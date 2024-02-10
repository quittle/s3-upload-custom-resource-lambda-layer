import { S3, paginateListObjectsV2, PutObjectRequest } from "@aws-sdk/client-s3";

export class SimpleS3 {
    private readonly s3 = new S3();

    public async deleteObject(bucketName: string, key: string): Promise<void> {
        await this.s3.deleteObject({ Bucket: bucketName, Key: key });
    }

    public async listObjects(
        bucketName: string,
        objectPrefix: string | undefined
    ): Promise<string[]> {
        const keys: string[] = [];
        for await (const page of paginateListObjectsV2(
            { client: this.s3 },
            {
                Bucket: bucketName,
                Prefix: objectPrefix,
            }
        )) {
            for (const object of page.Contents ?? []) {
                if (object.Key) {
                    keys.push(object.Key);
                }
            }
        }
        return keys;
    }

    public async isBucketEmpty(
        bucketName: string,
        objectPrefix: string | undefined
    ): Promise<boolean> {
        const objects = await this.s3.listObjectsV2({
            Bucket: bucketName,
            Prefix: objectPrefix,
            MaxKeys: 1,
        });
        return (objects.KeyCount ?? 0) === 0;
    }

    public async uploadFile(
        bucketName: string,
        objectPrefix: string | undefined,
        localFilePath: string,
        localFileContents: Buffer,
        extraParams?: PutObjectRequest
    ): Promise<void> {
        const key = (objectPrefix ?? "") + localFilePath;

        await this.s3.putObject({
            Bucket: bucketName,
            Key: key,
            Body: localFileContents,
            ...extraParams,
        });
    }
}

import S3 from "aws-sdk/clients/s3";
import { autoPaginate } from "./aws-helper";

export class SimpleS3 {
    private readonly s3: S3 = new S3();

    public async deleteObject(bucketName: string, key: string): Promise<void> {
        await this.s3.deleteObject({ Bucket: bucketName, Key: key }).promise();
    }

    public async listObjects(
        bucketName: string,
        objectPrefix: string | undefined
    ): Promise<string[]> {
        const response = await autoPaginate<S3, S3.ListObjectsV2Request, S3.ListObjectsV2Output>(
            this.s3,
            // eslint-disable-next-line @typescript-eslint/unbound-method
            this.s3.listObjectsV2,
            {
                Bucket: bucketName,
                Prefix: objectPrefix,
            }
        );
        const keys = response.reduce(
            (acc: string[], page) =>
                acc.concat(page.Contents?.map((object) => object?.Key) as string[]),
            []
        );
        return keys;
    }

    public async isBucketEmpty(
        bucketName: string,
        objectPrefix: string | undefined
    ): Promise<boolean> {
        return await this.s3
            .listObjectsV2({
                Bucket: bucketName,
                Prefix: objectPrefix,
                MaxKeys: 1,
            })
            .promise()
            .then((data) => {
                if (data.KeyCount && data.KeyCount > 0) {
                    return false;
                } else {
                    return true;
                }
            });
    }

    public async uploadFile(
        bucketName: string,
        objectPrefix: string | undefined,
        localFilePath: string,
        localFileContents: Buffer,
        extraParams?: S3.PutObjectRequest
    ): Promise<void> {
        const key = (objectPrefix || "") + localFilePath;

        await this.s3
            .upload({
                Bucket: bucketName,
                Key: key,
                Body: localFileContents,
                ...extraParams,
            })
            .promise();
    }
}

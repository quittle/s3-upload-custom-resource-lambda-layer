import * as S3 from "aws-sdk/clients/s3";

function notEmpty<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

export class SimpleS3 {
    private readonly s3: S3 = new S3();

    public async deleteObject(bucketName: string, key: string): Promise<void> {
        await this.s3.deleteObject({Bucket: bucketName, Key: key}).promise();
    }

    public async listObjects(bucketName: string, objectPrefix: string | undefined): Promise<string[]> {
        let ret: string[] = [];
        let continuationToken: string | undefined;
        while (true) {
            const params: S3.ListObjectsV2Request = {Bucket: bucketName, Prefix: objectPrefix};
            if (continuationToken) {
                params.ContinuationToken = continuationToken;
            }
            const response = await this.s3.listObjectsV2(params).promise()
            if (response.KeyCount && response.KeyCount > 0) {
                ret = ret.concat((response.Contents ?? []).map(obj => obj.Key).filter(notEmpty))
            }
            if (response.IsTruncated) {
                continuationToken = response.NextContinuationToken;
            } else {
                break;
            }
        }
        return ret;
    }

    public async isBucketEmpty(bucketName: string, objectPrefix: string | undefined): Promise<boolean> {
        return await this.s3.listObjectsV2({Bucket: bucketName, Prefix: objectPrefix, MaxKeys: 1})
                .promise()
                .then(data => {
                    if (data.KeyCount && data.KeyCount > 0) {
                        return false;
                    } else {
                        return true;
                    }
                });
    }

    public async uploadFile(bucketName: string, objectPrefix: string | undefined, localFilePath: string, localFileContents: Buffer): Promise<void> {
        const key = (objectPrefix || "") + localFilePath;
    
        await this.s3.upload({
            Bucket: bucketName,
            Key: key,
            Body: localFileContents}).promise();
    }
}

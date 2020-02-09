import { CloudformationEvent, ResponseStatus } from "../cloudformation-types";
import { SimpleS3 } from "../simple-s3";
import { CustomParameters, S3_UPLOAD_CONFIG_FILE } from "../resources";
import { SimpleFs } from "../simple-fs";
import { S3UploadConfig } from "../s3-upload-config";

export interface ResultType {
    status: ResponseStatus;
    reason?: string;
}

export type ResultCallback = (result: ResultType) => Promise<void>;

export interface RequestParameters {
    physicalId: string;
    bucketName: string;
    objectPrefix?: string;
}

export abstract class EventHandler {
    public async handle(event: CloudformationEvent, callback: ResultCallback): Promise<void> {
        const bucketName = event.ResourceProperties[CustomParameters.BUCKET_NAME];
        const objectPrefix = event.ResourceProperties[CustomParameters.OBJECT_PREFIX];
        const physicalId = `Bucket:${bucketName} ObjectPrefix: ${objectPrefix}`;

        if (!bucketName) {
            await callback({
                status: ResponseStatus.FAILED,
                reason: `${CustomParameters.BUCKET_NAME} must be specified.`
            });
            return;
        }

        const parameters: RequestParameters = {
            physicalId,
            bucketName,
            objectPrefix
        };

        const simpleFs = new SimpleFs();

        let s3UploadConfig;
        if (simpleFs.fileExists(S3_UPLOAD_CONFIG_FILE)) {
            try {
                const s3UploadConfigString = simpleFs.readFile(S3_UPLOAD_CONFIG_FILE).toString();
                s3UploadConfig = new S3UploadConfig(s3UploadConfigString);
            } catch (e) {
                await callback({
                    status: ResponseStatus.FAILED,
                    reason: `Unable to read or parse ${S3_UPLOAD_CONFIG_FILE}: ${e}`
                });
                return;
            }
        }

        let result;
        try {
            result = await this.handleEvent(parameters, new SimpleS3(), simpleFs, s3UploadConfig);
        } catch (e) {
            result = {
                status: ResponseStatus.FAILED,
                reason: `Failure when handling event. (${e})`
            };
        }

        await callback(result);
    }

    protected abstract async handleEvent(
        parameters: RequestParameters,
        simpleS3: SimpleS3,
        simpleFs: SimpleFs,
        s3UploadConfig?: S3UploadConfig
    ): Promise<ResultType>;
}

import { CloudformationEvent, ResponseStatus } from "./cloudformation-types";
import { SimpleS3 } from "./simple-s3";
import { CustomParameters } from "./resources";
import { SimpleFs } from "./simple-fs";

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

        let result;
        try {
            result = await this.handleEvent(parameters, new SimpleS3(), new SimpleFs());
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
        simpleFs: SimpleFs
    ): Promise<ResultType>;
}

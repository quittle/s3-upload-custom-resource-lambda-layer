import { IMinimatch, Minimatch } from "minimatch";
import deepmerge from "deepmerge";
import S3 from "aws-sdk/clients/s3";

/** Format of the config file  */
interface S3UploadFileStructure {
    [fileGlob: string]: S3ObjectConfig;
}

/** Represents a configuration in a given  */
interface S3ObjectConfig {
    metadata?: {
        [key: string]: string;
    };
    contentType?: string;
    contentDisposition?: string;
}

/** Internal representation of the parsed configuration */
type ParsedS3UploadConfig = [IMinimatch, S3ObjectConfig][];

/** Parses an S3 upload config file and provides S3 configuration for individual files */
class S3UploadConfig {
    private readonly parsedS3UploadConfig: ParsedS3UploadConfig;

    /**
     * Parses a configuration for matching against files later
     * @param s3UploadConfigContents The contents of the S3 upload configuration file
     */
    constructor(s3UploadConfigContents: string) {
        const fileJson = JSON.parse(s3UploadConfigContents) as S3UploadFileStructure;

        if (!(fileJson instanceof Object) || Array.isArray(fileJson)) {
            throw new Error(`Invalid config: ${s3UploadConfigContents}`);
        }

        this.parsedS3UploadConfig = Object.entries(fileJson).map(([key, value]) => [
            new Minimatch(key),
            value,
        ]);
    }

    /**
     * Returns a partial S3.PutObjectRequest for a given S3 object key.
     * @param objectKey The key name to match against in the config
     * @returns A partial S3.PutObjectRequest object based off the configuration
     */
    public getS3ParamsForKey(objectKey: string): S3.PutObjectRequest {
        let mergedConfig: S3ObjectConfig = {};
        for (const [matcher, config] of this.parsedS3UploadConfig) {
            if (matcher.match(objectKey)) {
                mergedConfig = deepmerge(mergedConfig, config);
            }
        }
        const putObjectRequest = {} as S3.PutObjectRequest;
        if (mergedConfig.metadata) {
            putObjectRequest.Metadata = mergedConfig.metadata;
        }
        if (mergedConfig.contentType) {
            putObjectRequest.ContentType = mergedConfig.contentType;
        }
        if (mergedConfig.contentDisposition) {
            putObjectRequest.ContentDisposition = mergedConfig.contentDisposition;
        }
        return putObjectRequest;
    }
}

export { S3UploadConfig };

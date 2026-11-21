import { Minimatch } from "minimatch";
import deepmerge from "deepmerge";
import { PutObjectRequest } from "@aws-sdk/client-s3";
import { z } from "zod";

/** Schema for the per-file S3 object config */
const S3ObjectConfigSchema = z
    .object({
        metadata: z.record(z.string(), z.string()).optional(),
        contentType: z.string().optional(),
        cacheControl: z.string().optional(),
        contentDisposition: z.string().optional(),
        websiteRedirectLocation: z.string().optional(),
    })
    .strict();

type S3ObjectConfig = z.infer<typeof S3ObjectConfigSchema>;

/** Schema for the redirects section: explicit object key to redirect target */
const RedirectsSchema = z.record(z.string(), z.string());

/**
 * Schema for a version 0 config: a flat map of glob patterns to S3 object
 * config. A config with no "version" field is version 0.
 */
const S3UploadConfigV0Schema = z.record(z.string(), S3ObjectConfigSchema);

type S3UploadConfigV0 = z.infer<typeof S3UploadConfigV0Schema>;

/** Schema for a version 1 config */
const S3UploadConfigV1Schema = z
    .object({
        version: z.literal(1),
        files: z.record(z.string(), S3ObjectConfigSchema).optional(),
        redirects: RedirectsSchema.optional(),
    })
    .strict();

type S3UploadConfigV1 = z.infer<typeof S3UploadConfigV1Schema>;

/** Top-level key holding the config version */
const VERSION_KEY = "version";

/** Internal representation of the parsed configuration */
type ParsedS3UploadConfig = [Minimatch, S3ObjectConfig][];

/** Parses an S3 upload config file and provides S3 configuration for individual files */
class S3UploadConfig {
    private readonly parsedS3UploadConfig: ParsedS3UploadConfig;
    private readonly redirects?: Record<string, string>;

    /**
     * Parses a configuration for matching against files later
     * @param s3UploadConfigContents The contents of the S3 upload configuration file
     */
    constructor(s3UploadConfigContents: string) {
        const fileJson: unknown = JSON.parse(s3UploadConfigContents);

        if (!(fileJson instanceof Object) || Array.isArray(fileJson)) {
            throw new Error(`Invalid config: ${s3UploadConfigContents}`);
        }

        const config = S3UploadConfig.parse(fileJson);

        if (config.redirects !== undefined) {
            S3UploadConfig.validateRedirectPaths(config.redirects);
        }
        this.redirects = config.redirects;

        this.parsedS3UploadConfig = Object.entries(config.files ?? {}).map(([key, value]) => [
            new Minimatch(key),
            value,
        ]);
    }

    /**
     * Parses the config as either version 0 or version 1 and returns it in
     * the version 1 shape. A config with no "version" field is version 0,
     * so its keys are treated as file globs.
     */
    private static parse(fileJson: object): S3UploadConfigV1 {
        const version = (fileJson as Record<string, unknown>)[VERSION_KEY];

        if (version === undefined) {
            const files: S3UploadConfigV0 = S3UploadConfigV0Schema.parse(fileJson);
            return { version: 1, files };
        }
        if (version === 1) {
            return S3UploadConfigV1Schema.parse(fileJson);
        }
        throw new Error(`Unsupported config version: ${JSON.stringify(version)}`);
    }

    /**
     * Validates the redirect paths. Redirect paths must be explicit paths,
     * not globs, since they name objects that have no corresponding file to
     * match against.
     */
    private static validateRedirectPaths(redirects: Record<string, string>): void {
        for (const path of Object.keys(redirects)) {
            if (new Minimatch(path).hasMagic()) {
                throw new Error(
                    `Invalid redirect path "${path}": redirect paths must be explicit paths, not globs`,
                );
            }
        }
    }

    /**
     * Returns the redirect objects to create, as a map from explicit object
     * key to redirect target. These have no corresponding file; the handler
     * creates each as an empty object with a WebsiteRedirectLocation.
     */
    public getRedirects(): Record<string, string> | undefined {
        return this.redirects;
    }

    /**
     * Returns a partial S3.PutObjectRequest for a given S3 object key.
     * @param objectKey The key name to match against in the config
     * @returns A partial S3.PutObjectRequest object based off the configuration
     */
    public getS3ParamsForKey(objectKey: string): PutObjectRequest {
        let mergedConfig: S3ObjectConfig = {};
        for (const [matcher, config] of this.parsedS3UploadConfig) {
            if (matcher.match(objectKey)) {
                mergedConfig = deepmerge(mergedConfig, config);
            }
        }
        const putObjectRequest = {} as PutObjectRequest;
        if (mergedConfig.metadata) {
            putObjectRequest.Metadata = mergedConfig.metadata;
        }
        if (mergedConfig.contentType) {
            putObjectRequest.ContentType = mergedConfig.contentType;
        }
        if (mergedConfig.cacheControl) {
            putObjectRequest.CacheControl = mergedConfig.cacheControl;
        }
        if (mergedConfig.contentDisposition) {
            putObjectRequest.ContentDisposition = mergedConfig.contentDisposition;
        }
        if (mergedConfig.websiteRedirectLocation) {
            putObjectRequest.WebsiteRedirectLocation = mergedConfig.websiteRedirectLocation;
        }
        return putObjectRequest;
    }
}

export { S3UploadConfig };

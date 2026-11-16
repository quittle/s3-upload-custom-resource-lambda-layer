import { Minimatch } from "minimatch";
import deepmerge from "deepmerge";
import { PutObjectRequest } from "@aws-sdk/client-s3";

/** Format of the config file  */
interface S3UploadFileStructure {
    [fileGlob: string]: S3ObjectConfig | Record<string, string>;
}

/** Represents a configuration in a given  */
interface S3ObjectConfig {
    metadata?: {
        [key: string]: string;
    };
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
    websiteRedirectLocation?: string;
}

/** Top-level key holding redirect objects that have no corresponding file */
const REDIRECTS_KEY = "redirects";

/** Internal representation of the parsed configuration */
type ParsedS3UploadConfig = [Minimatch, S3ObjectConfig][];

/** Parses an S3 upload config file and provides S3 configuration for individual files */
class S3UploadConfig {
    private readonly parsedS3UploadConfig: ParsedS3UploadConfig;
    private readonly redirects: Record<string, string>;

    /**
     * Parses a configuration for matching against files later
     * @param s3UploadConfigContents The contents of the S3 upload configuration file
     */
    constructor(s3UploadConfigContents: string) {
        const fileJson = JSON.parse(s3UploadConfigContents) as S3UploadFileStructure;

        if (!(fileJson instanceof Object) || Array.isArray(fileJson)) {
            throw new Error(`Invalid config: ${s3UploadConfigContents}`);
        }

        this.redirects = S3UploadConfig.parseRedirects(fileJson[REDIRECTS_KEY]);

        this.parsedS3UploadConfig = Object.entries(fileJson)
            .filter(([key]) => key !== REDIRECTS_KEY)
            .map(([key, value]) => [new Minimatch(key), value as S3ObjectConfig]);
    }

    /**
     * Parses and validates the redirects section. Redirect paths must be
     * explicit paths, not globs, since they name objects that have no
     * corresponding file to match against.
     */
    private static parseRedirects(redirects: unknown): Record<string, string> {
        if (redirects === undefined) {
            return {};
        }
        if (!(redirects instanceof Object) || Array.isArray(redirects)) {
            throw new Error(`Invalid redirects: ${JSON.stringify(redirects)}`);
        }
        for (const [path, target] of Object.entries(redirects)) {
            // hasMagic() misses brace expansion and extglob parens, so check
            // for glob characters directly.
            if (/[*?[\]{}()]/.test(path)) {
                throw new Error(
                    `Invalid redirect path "${path}": redirect paths must be explicit paths, not globs`,
                );
            }
            if (typeof target !== "string") {
                throw new Error(
                    `Invalid redirect target for "${path}": expected a string, got ${JSON.stringify(target)}`,
                );
            }
        }
        return redirects as Record<string, string>;
    }

    /**
     * Returns the redirect objects to create, as a map from explicit object
     * key to redirect target. These have no corresponding file; the handler
     * creates each as an empty object with a WebsiteRedirectLocation.
     */
    public getRedirects(): Record<string, string> {
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

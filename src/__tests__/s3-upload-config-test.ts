import { S3UploadConfig } from "../s3-upload-config";

/**
 * Helper function to build an S3UploadConfig while maintaining basic JSON type safety
 * @param config The config to serialize and construct an S3UploadConfig from
 */
function newS3UploadConfig(config: Record<string, unknown>): S3UploadConfig {
    return new S3UploadConfig(JSON.stringify(config));
}

describe("S3UploadConfig", () => {
    describe("invalid config", () => {
        test("empty string", () => {
            expect(() => new S3UploadConfig("")).toThrow("Unexpected end of JSON input");
        });

        test("non-json", () => {
            expect(() => new S3UploadConfig("?")).toThrow(
                "Unexpected token '?', \"?\" is not valid JSON",
            );
        });

        test("wrong type", () => {
            expect(() => new S3UploadConfig("[]")).toThrow("Invalid config: []");
        });
    });

    describe("valid config initializes", () => {
        test("trivial configs", () => {
            newS3UploadConfig({});
            newS3UploadConfig({ file: {} });
            newS3UploadConfig({ file1: {}, file2: {}, file3: {} });
            newS3UploadConfig({ file: { metadata: {} } });
            newS3UploadConfig({ file: { contentType: {} } });
            newS3UploadConfig({
                file: {
                    metadata: {},
                    contentType: "",
                    contentDisposition: "",
                    cacheControl: "",
                    websiteRedirectLocation: "",
                },
            });
            newS3UploadConfig({
                file: {
                    metadata: { key: "value" },
                    contentType: "",
                    contentDisposition: "",
                    cacheControl: "",
                    websiteRedirectLocation: "",
                },
            });
            newS3UploadConfig({
                file: {
                    metadata: null,
                    contentType: null,
                    contentDisposition: null,
                    cacheControl: null,
                    websiteRedirectLocation: null,
                },
            });
            newS3UploadConfig({ file: { unknownKey: "unknownValue" } });
        });

        test("expected config", () => {
            newS3UploadConfig({
                "*.txt": {
                    metadata: {
                        "my-key": "value",
                        otherKey: "value",
                    },
                    contentType: "text/plain",
                },
                "src/**/*.png": {
                    contentType: "image/png",
                    contentDisposition: 'attachment; filename="download.png"',
                    cacheControl: "public",
                },
            });
        });
    });

    describe("redirects", () => {
        test("no redirects section", () => {
            expect(newS3UploadConfig({}).getRedirects()).toStrictEqual({});
            expect(
                newS3UploadConfig({ "file.txt": { contentType: "text/plain" } }).getRedirects(),
            ).toStrictEqual({});
        });

        test("redirects are returned", () => {
            expect(
                newS3UploadConfig({
                    redirects: { rsvp: "/#rsvp", "old-page": "/new-page" },
                }).getRedirects(),
            ).toStrictEqual({ rsvp: "/#rsvp", "old-page": "/new-page" });
        });

        test("redirects key is not treated as a file glob", () => {
            const config = newS3UploadConfig({
                redirects: { rsvp: "/#rsvp" },
            });
            expect(config.getS3ParamsForKey("redirects")).toStrictEqual({});
            expect(config.getS3ParamsForKey("rsvp")).toStrictEqual({});
        });

        test("glob redirect path is rejected", () => {
            expect(() => newS3UploadConfig({ redirects: { "*.txt": "/x" } })).toThrow(
                'Invalid redirect path "*.txt"',
            );
            expect(() => newS3UploadConfig({ redirects: { "a[bc]": "/x" } })).toThrow(
                'Invalid redirect path "a[bc]"',
            );
            expect(() => newS3UploadConfig({ redirects: { "a{b,c}": "/x" } })).toThrow(
                'Invalid redirect path "a{b,c}"',
            );
        });

        test("non-string redirect target is rejected", () => {
            expect(() => newS3UploadConfig({ redirects: { rsvp: 123 } })).toThrow(
                'Invalid redirect target for "rsvp"',
            );
            expect(() => newS3UploadConfig({ redirects: { rsvp: null } })).toThrow(
                'Invalid redirect target for "rsvp"',
            );
        });

        test("non-object redirects is rejected", () => {
            expect(() => newS3UploadConfig({ redirects: "foo" })).toThrow("Invalid redirects");
            expect(() => newS3UploadConfig({ redirects: [] })).toThrow("Invalid redirects");
        });
    });

    describe("getS3ParamsForKey", () => {
        test("unknown key", () => {
            expect(newS3UploadConfig({}).getS3ParamsForKey("unknown key")).toStrictEqual({});
        });

        test("unexpected config is fine", () => {
            expect(
                newS3UploadConfig({ file: { random: "entry" } }).getS3ParamsForKey("file"),
            ).toStrictEqual({});
        });

        test("strict match file", () => {
            expect(
                newS3UploadConfig({
                    "file.txt": {
                        metadata: {
                            key: "value",
                        },
                        contentType: "text/plain",
                        contentDisposition: "inline; filename=other-name.txt",
                        cacheControl: "max-age=600",
                        websiteRedirectLocation: "/new-location",
                        randomKey: "value",
                    },
                }).getS3ParamsForKey("file.txt"),
            ).toStrictEqual({
                Metadata: {
                    key: "value",
                },
                ContentType: "text/plain",
                ContentDisposition: "inline; filename=other-name.txt",
                CacheControl: "max-age=600",
                WebsiteRedirectLocation: "/new-location",
            });
        });

        test("fuzzy match file", () => {
            expect(
                newS3UploadConfig({
                    "*.md": {
                        metadata: {
                            type: "markdown",
                        },
                    },
                }).getS3ParamsForKey("README.md"),
            ).toStrictEqual({
                Metadata: {
                    type: "markdown",
                },
            });
        });

        test("multi-pattern match merges", () => {
            expect(
                newS3UploadConfig({
                    "*/*.md": {
                        metadata: {
                            type: "markdown",
                        },
                    },
                    "src/*.md": {
                        metadata: {
                            isSrc: "true",
                        },
                        contentType: "text/markdown",
                    },
                }).getS3ParamsForKey("src/README.md"),
            ).toStrictEqual({
                Metadata: {
                    type: "markdown",
                    isSrc: "true",
                },
                ContentType: "text/markdown",
            });
        });

        test("match with overrides based on order of entry", () => {
            expect(
                newS3UploadConfig({
                    "*": {
                        contentType: "base",
                    },
                    file: {
                        contentType: "override",
                    },
                }).getS3ParamsForKey("file"),
            ).toStrictEqual({
                ContentType: "override",
            });

            expect(
                newS3UploadConfig({
                    file: {
                        contentType: "base",
                    },
                    "*": {
                        contentType: "override",
                    },
                }).getS3ParamsForKey("file"),
            ).toStrictEqual({
                ContentType: "override",
            });
        });
    });
});

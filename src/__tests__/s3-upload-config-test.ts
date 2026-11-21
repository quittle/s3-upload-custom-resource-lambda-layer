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
        });

        test("invalid per-file values are rejected", () => {
            expect(() => newS3UploadConfig({ file: { contentType: {} } })).toThrow();
            expect(() =>
                newS3UploadConfig({
                    file: {
                        metadata: null,
                        contentType: null,
                        contentDisposition: null,
                        cacheControl: null,
                        websiteRedirectLocation: null,
                    },
                }),
            ).toThrow();
            expect(() => newS3UploadConfig({ file: { unknownKey: "unknownValue" } })).toThrow();
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
            expect(newS3UploadConfig({}).getRedirects()).toBeUndefined();
            expect(
                newS3UploadConfig({ "file.txt": { contentType: "text/plain" } }).getRedirects(),
            ).toBeUndefined();
            expect(newS3UploadConfig({ version: 1 }).getRedirects()).toBeUndefined();
        });

        test("redirects are returned", () => {
            expect(
                newS3UploadConfig({
                    version: 1,
                    redirects: { rsvp: "/#rsvp", "old-page": "/new-page" },
                }).getRedirects(),
            ).toStrictEqual({ rsvp: "/#rsvp", "old-page": "/new-page" });
        });

        test("redirects are not supported in version 0", () => {
            // In a versionless config, "redirects" is just a glob key and its
            // value is not a valid per-file config, so it is rejected.
            expect(() => newS3UploadConfig({ redirects: { rsvp: "/#rsvp" } })).toThrow();
        });

        test("redirects key is not treated as a file glob", () => {
            const config = newS3UploadConfig({
                version: 1,
                redirects: { rsvp: "/#rsvp" },
            });
            expect(config.getS3ParamsForKey("redirects")).toStrictEqual({});
            expect(config.getS3ParamsForKey("rsvp")).toStrictEqual({});
        });

        test("glob redirect path is rejected", () => {
            expect(() => newS3UploadConfig({ version: 1, redirects: { "*.txt": "/x" } })).toThrow(
                'Invalid redirect path "*.txt"',
            );
            expect(() => newS3UploadConfig({ version: 1, redirects: { "a[bc]": "/x" } })).toThrow(
                'Invalid redirect path "a[bc]"',
            );
        });

        test("non-string redirect target is rejected", () => {
            expect(() => newS3UploadConfig({ version: 1, redirects: { rsvp: 123 } })).toThrow();
            expect(() => newS3UploadConfig({ version: 1, redirects: { rsvp: null } })).toThrow();
        });

        test("non-object redirects is rejected", () => {
            expect(() => newS3UploadConfig({ version: 1, redirects: "foo" })).toThrow();
            expect(() => newS3UploadConfig({ version: 1, redirects: [] })).toThrow();
        });
    });

    describe("versions", () => {
        test("version 0 is the flat format", () => {
            const config = newS3UploadConfig({
                "file.txt": { contentType: "text/plain" },
            });
            expect(config.getS3ParamsForKey("file.txt")).toStrictEqual({
                ContentType: "text/plain",
            });
            expect(config.getRedirects()).toBeUndefined();
        });

        test("explicit version 0 is rejected", () => {
            // Version 0 has no "version" field; an explicit one must be 1.
            expect(() =>
                newS3UploadConfig({
                    version: 0,
                    "file.txt": { contentType: "text/plain" },
                }),
            ).toThrow("Unsupported config version: 0");
        });

        test("version 1 parses files and redirects", () => {
            const config = newS3UploadConfig({
                version: 1,
                files: {
                    "file.txt": { contentType: "text/plain" },
                },
                redirects: { rsvp: "/#rsvp" },
            });
            expect(config.getS3ParamsForKey("file.txt")).toStrictEqual({
                ContentType: "text/plain",
            });
            expect(config.getRedirects()).toStrictEqual({ rsvp: "/#rsvp" });
            expect(config.getS3ParamsForKey("rsvp")).toStrictEqual({});
            expect(config.getS3ParamsForKey("files")).toStrictEqual({});
            expect(config.getS3ParamsForKey("version")).toStrictEqual({});
        });

        test("no version field means version 0, so a files key is just a glob", () => {
            // Without a version, the keys are file globs. A "files" key whose
            // value is a nested map is not a valid per-file config, so it is
            // rejected rather than treated as the version 1 files section.
            expect(() =>
                newS3UploadConfig({
                    files: {
                        "file.txt": { contentType: "text/plain" },
                    },
                    redirects: { rsvp: "/#rsvp" },
                }),
            ).toThrow();
        });

        test("version 1 with only a version field is empty", () => {
            const config = newS3UploadConfig({ version: 1 });
            expect(config.getS3ParamsForKey("file.txt")).toStrictEqual({});
            expect(config.getRedirects()).toBeUndefined();
        });

        test("version 1 files entries still support websiteRedirectLocation", () => {
            const config = newS3UploadConfig({
                version: 1,
                files: {
                    rsvp: { websiteRedirectLocation: "/#rsvp" },
                },
            });
            expect(config.getS3ParamsForKey("rsvp")).toStrictEqual({
                WebsiteRedirectLocation: "/#rsvp",
            });
        });

        test("unknown version is rejected", () => {
            expect(() => newS3UploadConfig({ version: 2, files: {} })).toThrow(
                "Unsupported config version: 2",
            );
            expect(() => newS3UploadConfig({ version: "1", files: {} })).toThrow(
                'Unsupported config version: "1"',
            );
            expect(() => newS3UploadConfig({ version: 1.5, files: {} })).toThrow(
                "Unsupported config version: 1.5",
            );
        });

        test("unknown top-level keys in version 1 are rejected", () => {
            // ZodError serializes its issues as JSON, so the key names are
            // escaped; matching on the error kind is enough here.
            expect(() => newS3UploadConfig({ version: 1, files: {}, extra: {} })).toThrow(
                "Unrecognized key",
            );
            expect(() => newS3UploadConfig({ version: 1, files: {}, "**/*.txt": {} })).toThrow(
                "Unrecognized key",
            );
        });

        test("a files key in a versionless config is just a glob", () => {
            // "files" is just a glob name in version 0. With a valid
            // per-file config as its value it matches a file named "files";
            // with a nested map as its value it is rejected.
            const config = newS3UploadConfig({
                files: { contentType: "text/plain" },
            });
            expect(config.getS3ParamsForKey("files")).toStrictEqual({
                ContentType: "text/plain",
            });
            expect(() => newS3UploadConfig({ files: { "file.txt": {} } })).toThrow();
        });

        test("non-object files in version 1 is rejected", () => {
            expect(() => newS3UploadConfig({ version: 1, files: "foo" })).toThrow();
            expect(() => newS3UploadConfig({ version: 1, files: [] })).toThrow();
        });
    });

    describe("getS3ParamsForKey", () => {
        test("unknown key", () => {
            expect(newS3UploadConfig({}).getS3ParamsForKey("unknown key")).toStrictEqual({});
        });

        test("unknown per-file key is rejected", () => {
            expect(() => newS3UploadConfig({ file: { random: "entry" } })).toThrow();
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

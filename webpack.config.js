const path = require("path");

function getAwsSdkExternals() {
    const packageJson = require("./package.json");
    return Object.fromEntries(
        Object.keys(packageJson["devDependencies"])
            .filter((key) => key.startsWith("@aws-sdk/client-"))
            .map((entry) => [entry, entry]),
    );
}

module.exports = {
    entry: "./src/index.ts",
    output: {
        filename: "s3-upload-custom-resource.js",
        path: path.resolve(__dirname, "dist"),
        asyncChunks: false,
    },
    externals: {
        ...getAwsSdkExternals(),
    },
    externalsType: "commonjs",
    mode: "production",
    target: "node",
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: [".ts", ".js"],
    },
};

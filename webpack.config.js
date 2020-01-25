const path = require('path');
const PrettierPlugin = require("prettier-webpack-plugin");

module.exports = {
    entry: './src/index.ts',
    output: {
        filename: 's3-upload-custom-resource.js',
        path: path.resolve(__dirname, 'dist'),
    },
    mode: 'production',
    target: 'node',
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    plugins: [
        new PrettierPlugin({
            tabWidth: 4,
            printWidth: 100,
        }),
    ],
    resolve: {
        extensions: [".ts", ".js"],
    },
};
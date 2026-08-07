const path = require("path");

module.exports = {
    mode: "development",
    target: "node",
    entry: "./test/smoke.ts",
    devtool: false,
    externals: {
        jsdom: "commonjs jsdom"
    },
    output: {
        path: path.resolve(__dirname, ".test-build"),
        filename: "smoke.bundle.js"
    },
    resolve: {
        extensions: [".ts", ".js"],
        alias: {
            [path.resolve(__dirname, "style/visual.less")]: path.resolve(__dirname, "test/less-stub.js")
        }
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: {
                    loader: "ts-loader",
                    options: { configFile: "tsconfig.test.json", transpileOnly: true }
                },
                exclude: /node_modules/
            }
        ]
    },
    performance: { hints: false }
};

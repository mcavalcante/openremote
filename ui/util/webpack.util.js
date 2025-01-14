const fs = require("fs");
const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

function getAppConfig(mode, isDevServer, dirname, managerUrl, keycloakUrl) {
    const production = mode === "production";
    managerUrl = managerUrl || (production ? undefined : "http://localhost:8080");
    const OUTPUT_PATH = isDevServer ? 'src' : 'dist';

    const config = {
        entry: {
            'bundle': './src/index.js'
        },
        output: {
            path: dirname + "/dist",
            publicPath: "/" + dirname.split(path.sep).slice(-1)[0] + "/",
            filename: "[name].[contenthash].js"
        },
        module: {
            rules: [
                {
                    test: /(maplibre|mapbox|@material).*\.css$/, //output mapbox and material css as strings
                    type: "asset/source"
                },
                {
                    test: /\.css$/, //
                    exclude: /(maplibre|mapbox|@material).*\.css$/,
                    use: [
                        { loader: "css-loader" }
                    ]
                },
                {
                    test: /\.(png|jpg|ico|gif|svg|eot|ttf|woff|woff2)$/,
                    type: "asset",
                    generator: {
                        filename: 'images/[hash][ext][query]'
                    }
                }
            ]
        },
        // optimization: {
        //     minimize: true,
        //     minimizer: [
        //         // For webpack@5 you can use the `...` syntax to extend existing minimizers (i.e. `terser-webpack-plugin`), uncomment the next line
        //         // `...`,
        //         new CssMinimizerPlugin(),
        //     ],
        // },
        resolve: {
            fallback: { "vm": false }
        }
    };

    if (production) {
        // Only use babel for production otherwise source maps don't work
        config.module.rules.push(
            {
                test: /\.js$/,
                include: function(modulePath) {
                    return /(@webcomponents[\/|\\]shadycss|lit-css|styled-lit-element|lit-element|lit-html|@polymer|@lit|pwa-helpers)/.test(modulePath) || !/node_modules/.test(modulePath);
                },
                use: [
                    {
                        loader: 'babel-loader'
                    }
                ]
            },
        );
    } else {
        // Load source maps generated by typescript
        config.module.rules.push(
            {
                test: /\.js$/,
                use: ["source-map-loader"],
                enforce: "pre",
                exclude: [
                    /node_modules/
                ]
            },
        );
    }

    config.plugins = [];

    // Conditional compilation variables
    config.plugins.push(
        new webpack.DefinePlugin({
            PRODUCTION: JSON.stringify(production),
            MANAGER_URL: JSON.stringify(managerUrl),
            KEYCLOAK_URL: JSON.stringify(keycloakUrl),
            "process.env":   {
                BABEL_ENV: JSON.stringify(mode)
            }
        })
    );

    // Generate our index page
    config.plugins.push(
        new HtmlWebpackPlugin({
            chunksSortMode: 'none',
            inject: false,
            template: 'index.html'
        })
    );

    // Build list of resources to copy
    const patterns = [
        {
            from: path.dirname(require.resolve("@webcomponents/webcomponentsjs")),
            to: "modules/@webcomponents/webcomponentsjs",
            globOptions: {
                ignore: ["!*.js"]
            }
        },
    ];
    // Check if images dir exists
    if (fs.existsSync(path.join(dirname, "images"))) {
        patterns.push(
            {
                from: "./images",
                    to: "images"
            }
        );
    }
    // Check if locales dir exists
    if (fs.existsSync(path.join(dirname, "locales"))) {
        patterns.push(
            {
                from: "./locales",
                to: "locales"
            }
        );
    }
    // Check if htaccess file exists
    if (fs.existsSync(path.join(dirname, ".htaccess"))) {
        patterns.push(
            {
                from: ".htaccess",
                to: ".htaccess",
                toType: 'file'
            }
        );
    }

    // Copy unprocessed files
    config.plugins.push(
        new CopyWebpackPlugin({
            patterns: patterns
        })
    );

    config.devtool = production ? false : "inline-source-map";
    config.devServer = {
        historyApiFallback: {
            index: "/" + dirname.split(path.sep).slice(-1)[0] + "/",
        },
        port: 9000,
        open: false,
        static: OUTPUT_PATH
    };
    config.watchOptions = {
        ignored: ['**/*.ts', 'node_modules']
    }

    return config;
}

function getLibName(componentName) {
    if (componentName.startsWith("or-")) {
        componentName = componentName.substr(3);
    }
    componentName = componentName.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
    return "OR" + componentName.charAt(0).toUpperCase() + componentName.substring(1);
}

function ORExternals(context, request, callback) {
    const match = request.match(/^@openremote\/([^\/]*)$/);
    if (match) {
        let component = getLibName(match[1]);
        console.log(request + " => " + component);
        return callback(null, "umd " + component);
    }
    callback();
}

function generateExternals(bundle) {
    if (!bundle) {
        return;
    }

    const externals = [];

    if (bundle.excludeOr) {
        externals.push(ORExternals);
    }
    if (bundle.vendor) {
        externals.push(bundle.vendor);
    }

    return externals;
}

function generateExports(dirname) {

    let libName = getLibName(dirname.split(path.sep).pop());

    return Object.entries(bundles).map(([name, bundle]) => {
        const entry = {};
        entry[name] = "./dist/index.js";

        return {
            entry: entry,
            mode: "production",
            output: {
                filename: "[name].js",
                path: path.resolve(dirname, "dist/umd"),
                library: libName,
                libraryTarget: "umd"
            },
            externals: generateExternals(bundle)
        };
    });
}

module.exports = {
    getLibName: getLibName,
    generateExports: generateExports,
    getAppConfig: getAppConfig
};

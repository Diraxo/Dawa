module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // Transforms import.meta → globalThis.__ExpoImportMetaRegistry so
          // packages built with Vite (that use import.meta.env.MODE) don't
          // throw SyntaxError in Metro's non-module web bundle.
          unstable_transformImportMeta: true,
        },
      ],
    ],
  }
}

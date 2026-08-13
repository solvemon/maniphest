import babelParser from '@babel/eslint-parser';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo'],
  },
  {
    files: ['packages/sim/**/*.ts'],
    languageOptions: {
      parser: babelParser,
      sourceType: 'module',
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-typescript'],
        },
      },
    },
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'sim randomness must go through worldRng/eventRng',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'crypto',
          message: 'sim must be deterministic: no wall-clock or crypto entropy',
        },
        {
          name: 'Date',
          message: 'sim must be deterministic: no wall-clock or crypto entropy',
        },
      ],
    },
  },
];

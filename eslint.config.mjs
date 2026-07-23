import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Purity rules (docs 05 §3 rule 2, 08 §6): pure packages may not read the
 * clock, use randomness, or touch the environment. Time is always an input.
 */
const purityRestrictions = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Date',
      property: 'now',
      message: 'Pure packages take time as an explicit input (doc 05 §3).',
    },
    {
      object: 'Math',
      property: 'random',
      message: 'Pure packages must be deterministic (doc 05 §3).',
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'process', message: 'Pure packages may not read the environment (doc 05 §3).' },
    {
      name: 'performance',
      message: 'performance.now() reads the clock; pure packages take time as input (R-14).',
    },
    {
      name: 'crypto',
      message: 'Global webcrypto provides randomness; pure packages must be deterministic (R-14).',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'Zero-arg new Date() reads the clock; pure packages take time as input (doc 05 §3).',
    },
  ],
};

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'out/**', 'tools/golden/expected/**', '.claude/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/**/*.ts'],
    rules: purityRestrictions,
  },
  prettier,
);

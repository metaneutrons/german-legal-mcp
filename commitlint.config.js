export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New feature
        'fix',      // Bug fix
        'docs',     // Documentation
        'style',    // Formatting, no code change
        'refactor', // Code restructuring
        'perf',     // Performance improvement
        'test',     // Adding tests
        'chore',    // Maintenance
        'ci',       // CI/CD changes
        'build',    // Build system changes
        'revert',   // Revert previous commit
      ],
    ],
    'scope-enum': [
      1,
      'always',
      [
        'beck',     // Beck Online related
        'gii',      // Gesetze im Internet
        'rii',      // Rechtsprechung im Internet
        'core',     // Core functionality
        'deps',     // Dependencies
        'config',   // Configuration
      ],
    ],
  },
};

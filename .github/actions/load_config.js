const fs = require('fs');
const yaml = require('js-yaml');

// Path to the configuration file
const configPath = '.github/config/code_analysis_config.yml';

// Load configuration file
let config;
try {
  config = yaml.load(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error(`Error: Could not load configuration file at ${configPath}`);
  process.exit(1); // Exit with failure if the config file cannot be loaded
}

// Load GitHub Action inputs, which are automatically passed as environment variables
const directoryInput = process.env.INPUT_DIRECTORY;
const excludeInput = process.env.INPUT_EXCLUDE;

// Ensure all required parameters have values, else exit with an error
const maxSizeMb = config.max_size_mb;
if (maxSizeMb === undefined) {
  console.error('Error: max_size_mb is not defined in the configuration file');
  process.exit(1);
}

const approvedTypes = config.approved_types;
if (!approvedTypes || approvedTypes.length === 0) {
  console.error('Error: approved_types is not defined in the configuration file');
  process.exit(1);
}

const maxCallsPerHour = config.max_calls_per_hour;
if (maxCallsPerHour === undefined) {
  console.error('Error: max_calls_per_hour is not defined in the configuration file');
  process.exit(1);
}

// For directory and exclude patterns, ensure at least one value is provided (either input or config)
const directory = directoryInput || config.directory;
if (!directory) {
  console.error('Error: directory is not provided as an input or in the configuration file');
  process.exit(1);
}

const exclude = excludeInput || config.exclude;
if (exclude === undefined) {
  console.error('Error: exclude is not provided as an input or in the configuration file');
  process.exit(1);
}

// Output environment variables
console.log(`MAX_SIZE_MB=${maxSizeMb}`);
console.log(`APPROVED_TYPES=${approvedTypes.join(',')}`);
console.log(`MAX_CALLS_PER_HOUR=${maxCallsPerHour}`);
console.log(`DIRECTORY=${directory}`);
console.log(`EXCLUDE=${exclude}`);

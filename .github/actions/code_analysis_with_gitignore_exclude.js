const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { minimatch } = require('minimatch');

// Parse and normalize approved types with leading dots and lowercase
let approvedTypes = process.env.APPROVED_TYPES.split(',').map(ext => ext.trim().toLowerCase());

// Additional safeguard to handle single string edge case
if (approvedTypes.length === 1 && approvedTypes[0].includes(' ')) {
  approvedTypes = approvedTypes[0].split(' ').map(ext => ext.trim().toLowerCase());
}

console.log("Parsed approved types:", approvedTypes);  // Debugging approved types

const maxSizeBytes = parseInt(process.env.MAX_SIZE_MB, 10) * 1024 * 1024;
const maxCallsPerHour = parseInt(process.env.MAX_CALLS_PER_HOUR, 10) || 3;
const directory = process.env.DIRECTORY;
const excludePatterns = process.env.EXCLUDE ? process.env.EXCLUDE.split(',') : [];
const openaiApiKey = process.env.OPENAI_API_KEY;
const callCountFile = path.join('.github/actions/hourly_call_count.json');
const oneHour = 60 * 60 * 1000;

/**
 * Generates a unique hash for each API call.
 * @returns {string} A unique 12-character hash.
 */
function generateUniqueHash() {
  return crypto.createHash('md5').update(Date.now().toString() + Math.random().toString()).digest('hex').slice(0, 12);
}

/**
 * Retrieves the current call count, filtering out entries older than one hour.
 * @returns {{count: number, calls: Array<{hash: string, timestamp: number}>}}
 * The current count and an array of recent call entries.
 */
function getHourlyCallCount() {
  if (!fs.existsSync(callCountFile)) {
    console.log('No previous call count file found. Initializing new count.');
    return { count: 0, calls: [] };
  }

  const data = JSON.parse(fs.readFileSync(callCountFile, 'utf8'));
  const currentTime = Date.now();
  console.log(`Current time: ${currentTime}, Previous calls:`, data.calls);

  // Filter to keep only calls within the last hour
  const recentCalls = data.calls.filter(call => currentTime - call.timestamp < oneHour);
  console.log(`Filtered recent calls within the last hour: ${recentCalls.length}`);

  return {
    count: recentCalls.length,
    calls: recentCalls
  };
}

/**
 * Updates the call count file with a new API call entry and applies the sliding window.
 */
function updateHourlyCallCount() {
  const currentData = getHourlyCallCount();
  const newCall = {
    hash: generateUniqueHash(),
    timestamp: Date.now()
  };

  // Add new call and reapply the sliding window to keep only recent calls
  currentData.calls.push(newCall);
  const recentCalls = currentData.calls.filter(call => Date.now() - call.timestamp < oneHour);

  // Update count and calls in the JSON file
  currentData.count = recentCalls.length;
  currentData.calls = recentCalls;

  console.log('Updated call count:', currentData);
  fs.writeFileSync(callCountFile, JSON.stringify(currentData, null, 2));
}

/**
 * Checks if a file path matches any of the exclude patterns.
 * @param {string} filePath - The path of the file to check.
 * @returns {boolean} True if the file should be excluded, false otherwise.
 */
function isExcluded(filePath) {
  const result = excludePatterns.some(pattern => minimatch(filePath, pattern.trim()));
  console.log(`Checking if file "${filePath}" should be excluded: ${result}`);
  return result;
}

/**
 * Loads files from the specified directory, applying filters for approved types and exclusions.
 * @returns {{combinedText: string, totalSize: number}} The combined content of approved files and the total size.
 */
function loadApprovedFiles() {
  if (!fs.existsSync(directory)) {
    console.error(`Error: Specified directory "${directory}" does not exist.`);
    process.exit(1);
  }

  let combinedText = '';
  let totalSize = 0;

  console.log(`Reading files in directory: ${directory}`);
  const files = fs.readdirSync(directory).filter(file => {
    const filePath = path.join(directory, file);
    const fileExtension = path.extname(file).toLowerCase();  // Normalize to lowercase
    const isApprovedType = approvedTypes.includes(fileExtension);
    const isNotExcluded = !isExcluded(filePath);

    // Additional logging to understand the decision-making process
    console.log(`File: ${file}`);
    console.log(` - Extension: ${fileExtension}`);
    console.log(` - Is approved type: ${isApprovedType}`);
    console.log(` - Is not excluded: ${isNotExcluded}`);

    return isApprovedType && isNotExcluded;
  });

  console.log(`Files to process: ${files}`);

  for (const file of files) {
    const filePath = path.join(directory, file);
    const fileSize = fs.statSync(filePath).size;

    console.log(`Processing file: ${filePath} (size: ${fileSize} bytes)`);

    if (totalSize + fileSize > maxSizeBytes) {
      console.log(`Skipping file ${filePath} (size exceeds limit)`);
      continue;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    combinedText += `\n### File: ${filePath} ###\n\n${fileContent}\n`;
    totalSize += fileSize;

    console.log(`Total accumulated size: ${totalSize} bytes`);

    if (totalSize >= maxSizeBytes) {
      console.log(`Total size limit reached at ${totalSize} bytes.`);
      break;
    }
  }

  console.log(`Final content size: ${totalSize} bytes`);
  return { combinedText, totalSize };
}

/**
 * Sends code content to the ChatGPT API for analysis and logs the API response.
 * @param {string} inputText - The code content to analyze.
 * @returns {Promise<string>} The response from the ChatGPT API.
 */
async function getAIFindings(inputText) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a code review assistant.' },
        { role: 'user', content: `Analyze the following code:\n\n${inputText}` }
      ]
    },
    { headers: { Authorization: `Bearer ${openaiApiKey}` } }
  );

  // Log response to a file for review (only for testing purposes)
  const logFile = '.github/actions/live_test_log.json';
  const logData = { timestamp: Date.now(), response: response.data };
  fs.appendFileSync(logFile, JSON.stringify(logData, null, 2) + ',\n');

  return response.data.choices[0].message.content;
}

/**
 * Main function to control workflow: loads files, checks rate limits, and analyzes code with ChatGPT.
 */
async function main() {
  const { count } = getHourlyCallCount();

  if (count >= maxCallsPerHour) {
    console.log(`Info: Maximum ChatGPT call limit of ${maxCallsPerHour} per hour reached. Skipping analysis.`);
    return;
  }

  const { combinedText, totalSize } = loadApprovedFiles();

  if (totalSize > maxSizeBytes) {
    console.log(`Info: Total file size (${totalSize} bytes) exceeds limit of ${maxSizeBytes} bytes. Skipping analysis.`);
  } else if (!combinedText.trim()) {
    console.log('Info: No approved file types found. Skipping analysis.');
  } else {
    try {
      const findings = await getAIFindings(combinedText);
      console.log('AI Findings:', findings);
      updateHourlyCallCount();
    } catch (error) {
      console.error('Error during ChatGPT analysis:', error);
    }
  }
}

main().catch(console.error);

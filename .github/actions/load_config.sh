#!/bin/bash

CONFIG_FILE=".github/config/code_analysis_config.yml"

# Check if the configuration file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: Configuration file not found at $CONFIG_FILE"
  exit 1
fi

# Load values from the YAML configuration file using yq
MAX_SIZE_MB=$(yq e '.max_size_mb' "$CONFIG_FILE")
APPROVED_TYPES=$(yq e '.approved_types | join(" ")' "$CONFIG_FILE")
MAX_CALLS_PER_HOUR=$(yq e '.max_calls_per_hour' "$CONFIG_FILE")
DEFAULT_DIRECTORY=$(yq e '.directory' "$CONFIG_FILE")
DEFAULT_EXCLUDE=$(yq e '.exclude' "$CONFIG_FILE")

# Check required values and prioritize inputs over config defaults
if [[ -z "$MAX_SIZE_MB" ]]; then
  echo "Error: max_size_mb is not defined in the configuration file"
  exit 1
fi

if [[ -z "$APPROVED_TYPES" ]]; then
  echo "Error: approved_types is not defined in the configuration file"
  exit 1
fi

if [[ -z "$MAX_CALLS_PER_HOUR" ]]; then
  echo "Error: max_calls_per_hour is not defined in the configuration file"
  exit 1
fi

DIRECTORY="${INPUT_DIRECTORY:-$DEFAULT_DIRECTORY}"
EXCLUDE="${INPUT_EXCLUDE:-$DEFAULT_EXCLUDE}"

if [[ -z "$DIRECTORY" ]]; then
  echo "Error: directory is not provided as an input or in the configuration file"
  exit 1
fi

if [[ -z "$EXCLUDE" ]]; then
  echo "Error: exclude is not provided as an input or in the configuration file"
  exit 1
fi

# Debug logging
echo "Debug: MAX_SIZE_MB=${MAX_SIZE_MB}"
echo "Debug: APPROVED_TYPES=${APPROVED_TYPES}"
echo "Debug: MAX_CALLS_PER_HOUR=${MAX_CALLS_PER_HOUR}"
echo "Debug: DIRECTORY=${DIRECTORY}"
echo "Debug: EXCLUDE=${EXCLUDE}"

# Set environment variables for GitHub Actions
{
  echo "MAX_SIZE_MB=${MAX_SIZE_MB}"
  echo "APPROVED_TYPES=${APPROVED_TYPES}"
  echo "MAX_CALLS_PER_HOUR=${MAX_CALLS_PER_HOUR}"
  echo "DIRECTORY=${DIRECTORY}"
  echo "EXCLUDE=${EXCLUDE}"
} >> "$GITHUB_ENV"

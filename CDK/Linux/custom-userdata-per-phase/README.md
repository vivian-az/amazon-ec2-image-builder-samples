# Custom User Data Per Phase - CDK

This CDK application demonstrates how to use different user data scripts during the BUILD and TEST phases of an EC2 Image Builder pipeline.

## Overview

- **Build Phase**: Uses the default Image Builder build workflow with user data embedded in the recipe
- **Test Phase**: Uses a custom workflow with Lambda to launch test instances with different user data

## Architecture

The CDK stack creates:
- Image Builder pipeline with custom test workflow
- Lambda function that launches test instances with custom user data
- IAM roles for EC2 instances, Lambda, and Image Builder
- Infrastructure configuration for build and test instances

## Prerequisites

- Node.js 20.x or later
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- AWS account bootstrapped for CDK
- Docker (for Lambda bundling)

## Installation

```bash
npm install
```

## Configuration

The stack accepts the following parameters (can be set during deployment):

- `BuildUserData`: User data script for BUILD phase (default: creates `/tmp/hello-test/speak.txt` with "hello build")
- `TestUserData`: User data script for TEST phase (default: creates `/tmp/hello-test/speak.txt` with "hello test")
- `InstanceType`: Instance type for build/test (default: m5.large)

## Deployment

```bash
# Synthesize CloudFormation template
npm run build
cdk synth

# Deploy the stack
cdk deploy

# Deploy with custom parameters
cdk deploy --parameters BuildUserData="#!/bin/bash\necho custom build" \
           --parameters TestUserData="#!/bin/bash\necho custom test"
```

## How It Works

1. **Build Phase**: The recipe includes user data via `AdditionalInstanceConfiguration.UserDataOverride` that runs during the build instance launch
2. **Test Phase**: A custom workflow uses `WaitForAction` to invoke a Lambda function that:
   - Retrieves the AMI created during build
   - Launches a test instance with different user data
   - Waits for the instance to be ready
   - Resumes the workflow to apply test components
   - Terminates the test instance when complete

## Cleanup

```bash
cdk destroy
```

## Use Cases

This pattern is useful when you need:
- Different initialization logic during build vs test
- To validate software with different configurations
- To test the built AMI with specific runtime settings

## Files

- `bin/cdk.ts` - CDK app entry point
- `lib/custom-userdata-stack.ts` - Main stack definition
- `lambda/test-launch-handler.py` - Lambda function for launching test instances

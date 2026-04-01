# Custom User Data Per Phase

This sample demonstrates how to use different user data scripts during the BUILD and TEST phases of an EC2 Image Builder pipeline.

## Overview

- **Build Phase**: Uses the default Image Builder build workflow with user data embedded in the recipe
- **Test Phase**: Uses a custom workflow with Lambda to launch test instances with different user data

## Architecture

The template creates:
- Image Builder pipeline with custom test workflow
- Lambda function that launches test instances with custom user data
- IAM roles for EC2 instances, Lambda, and Image Builder
- Infrastructure configuration for build and test instances

## How It Works

1. **Build Phase**: The recipe includes user data via `AdditionalInstanceConfiguration.UserDataOverride` that runs during the build instance launch
2. **Test Phase**: A custom workflow uses `WaitForAction` to invoke a Lambda function that:
   - Retrieves the AMI created during build
   - Launches a test instance with different user data
   - Waits for the instance to be ready
   - Resumes the workflow to apply test components
   - Terminates the test instance when complete

## Parameters

- `SubnetId`: (Optional) Subnet for build/test instances
- `SecurityGroupId`: (Optional) Security group for build/test instances
- `InstanceType`: Instance type (default: m5.large)
- `BuildUserData`: User data script for BUILD phase
- `TestUserData`: User data script for TEST phase

## Deployment

```bash
aws cloudformation create-stack \
  --stack-name custom-userdata-pipeline \
  --template-body file://custom-userdata-per-phase.yml \
  --capabilities CAPABILITY_IAM
```

## Use Cases

This pattern is useful when you need:
- Different initialization logic during build vs test
- To validate software with different configurations
- To test the built AMI with specific runtime settings

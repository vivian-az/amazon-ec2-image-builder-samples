#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CustomUserdataStack } from '../lib/custom-userdata-stack';

const app = new cdk.App();

new CustomUserdataStack(app, 'CustomUserdataPerPhaseStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'EC2 Image Builder with custom user data per phase (build vs test)',
});

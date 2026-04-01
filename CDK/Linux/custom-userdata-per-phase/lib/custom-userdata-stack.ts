import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export class CustomUserdataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Parameters
    const buildUserData = new cdk.CfnParameter(this, 'BuildUserData', {
      type: 'String',
      default: `#!/bin/bash
mkdir -p /tmp/hello-test
echo "hello build" > /tmp/hello-test/speak.txt`,
      description: 'User data script for the BUILD phase',
    });

    const testUserData = new cdk.CfnParameter(this, 'TestUserData', {
      type: 'String',
      default: `#!/bin/bash
mkdir -p /tmp/hello-test
echo "hello test" > /tmp/hello-test/speak.txt`,
      description: 'User data script for the TEST phase',
    });

    const instanceType = new cdk.CfnParameter(this, 'InstanceType', {
      type: 'String',
      default: 'm5.large',
      allowedValues: ['t3.micro', 't3.small', 't3.medium', 't3.large', 'm5.large', 'm5.xlarge'],
    });

    // Get latest AL2023 AMI
    const latestAmiId = ssm.StringParameter.valueForStringParameter(
      this,
      '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64'
    );

    // EC2 Instance Role
    const ec2Role = new iam.Role(this, 'EC2InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilder'),
      ],
    });

    const instanceProfile = new iam.CfnInstanceProfile(this, 'InstanceProfile', {
      roles: [ec2Role.roleName],
    });

    // Lambda for test instance launch
    const testLaunchLambda = new lambda.Function(this, 'TestLaunchFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'test-launch-handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.minutes(10),
      environment: {
        TEST_USER_DATA: testUserData.valueAsString,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    testLaunchLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['imagebuilder:GetImage', 'imagebuilder:SendWorkflowStepAction'],
        resources: ['*'],
      })
    );

    testLaunchLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:RunInstances',
          'ec2:CreateTags',
          'ec2:DescribeInstances',
          'ec2:DescribeInstanceStatus',
        ],
        resources: ['*'],
      })
    );

    testLaunchLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [ec2Role.roleArn],
      })
    );

    testLaunchLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:DescribeInstanceInformation'],
        resources: ['*'],
      })
    );

    // Image Builder Execution Role
    const imageBuilderRole = new iam.Role(this, 'ImageBuilderRole', {
      assumedBy: new iam.ServicePrincipal('imagebuilder.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/EC2ImageBuilderLifecycleExecutionPolicy'
        ),
      ],
    });

    imageBuilderRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [testLaunchLambda.functionArn],
      })
    );

    imageBuilderRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [ec2Role.roleArn],
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'ec2.amazonaws.com',
          },
        },
      })
    );

    // Infrastructure Configuration
    const infraConfig = new imagebuilder.CfnInfrastructureConfiguration(
      this,
      'InfraConfig',
      {
        name: `${cdk.Stack.of(this).stackName}-InfraConfig`,
        instanceProfileName: instanceProfile.ref,
        instanceTypes: [instanceType.valueAsString],
        terminateInstanceOnFailure: true,
        instanceMetadataOptions: {
          httpPutResponseHopLimit: 2,
          httpTokens: 'required',
        },
      }
    );

    // Image Recipe with build user data
    const recipe = new imagebuilder.CfnImageRecipe(this, 'Recipe', {
      name: `${cdk.Stack.of(this).stackName}-Recipe`,
      version: '1.3.0',
      parentImage: latestAmiId,
      components: [
        {
          componentArn: `arn:${cdk.Stack.of(this).partition}:imagebuilder:${
            cdk.Stack.of(this).region
          }:aws:component/hello-world-linux/x.x.x`,
        },
      ],
      additionalInstanceConfiguration: {
        userDataOverride: cdk.Fn.base64(buildUserData.valueAsString),
      },
    });

    // Distribution Configuration
    const distConfig = new imagebuilder.CfnDistributionConfiguration(this, 'DistConfig', {
      name: `${cdk.Stack.of(this).stackName}-DistConfig`,
      distributions: [
        {
          region: cdk.Stack.of(this).region,
          amiDistributionConfiguration: {
            name: `${cdk.Stack.of(this).stackName}-{{imagebuilder:buildDate}}`,
          },
        },
      ],
    });

    // Custom Test Workflow
    const testWorkflow = new imagebuilder.CfnWorkflow(this, 'TestWorkflow', {
      name: `${cdk.Stack.of(this).stackName}-TestWorkflow`,
      description: 'Test workflow that launches instance via Lambda with test-specific user data',
      type: 'TEST',
      version: '1.0.0',
      data: `name: custom-launch-test
description: Test workflow using WaitForAction to launch instance with test-specific user data
schemaVersion: 1.0

steps:
  - name: LaunchTestInstance
    action: WaitForAction
    onFailure: Abort
    inputs:
      lambdaFunctionName: ${testLaunchLambda.functionName}

  - name: ApplyTestComponents
    action: ExecuteComponents
    onFailure: Abort
    inputs:
      instanceId.$: "$.stepOutputs.LaunchTestInstance.reason"

  - name: TerminateTestInstance
    action: TerminateInstance
    onFailure: Continue
    inputs:
      instanceId.$: "$.stepOutputs.LaunchTestInstance.reason"`,
    });

    // Image Pipeline
    new imagebuilder.CfnImagePipeline(this, 'Pipeline', {
      name: `${cdk.Stack.of(this).stackName}-Pipeline`,
      infrastructureConfigurationArn: infraConfig.attrArn,
      distributionConfigurationArn: distConfig.attrArn,
      imageRecipeArn: recipe.attrArn,
      executionRole: imageBuilderRole.roleArn,
      workflows: [
        {
          workflowArn: `arn:${cdk.Stack.of(this).partition}:imagebuilder:${
            cdk.Stack.of(this).region
          }:aws:workflow/build/build-image/x.x.x`,
        },
        {
          workflowArn: testWorkflow.attrArn,
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'TestLambdaArn', {
      value: testLaunchLambda.functionArn,
      description: 'Lambda function ARN for test instance launch',
    });
  }
}

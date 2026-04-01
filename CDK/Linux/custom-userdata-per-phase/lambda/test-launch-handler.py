import boto3
import json
import os
import base64
import time

ec2 = boto3.client('ec2')
ib = boto3.client('imagebuilder')
ssm = boto3.client('ssm')

def handler(event, context):
    """
    Invoked by Image Builder WaitForAction step in the test workflow.
    Launches a test instance using the built AMI with custom test user data.
    """
    print(json.dumps(event))

    image_arn = event['imageArn']
    step_execution_id = event['workflowStepExecutionId']

    try:
        # Fetch image details
        image = ib.get_image(imageBuildVersionArn=image_arn)['image']
        infra = image.get('infrastructureConfiguration', {})

        # Get the AMI built in the build phase
        amis = image.get('outputResources', {}).get('amis', [])
        if not amis or not amis[0].get('image'):
            raise Exception('No output AMI found. Build may not have completed.')
        ami_id = amis[0]['image']

        # Encode test user data
        user_data_b64 = base64.b64encode(
            os.environ['TEST_USER_DATA'].encode('utf-8')
        ).decode('utf-8')

        # Build RunInstances params from infra config
        run_params = {
            'ImageId': ami_id,
            'MinCount': 1,
            'MaxCount': 1,
            'InstanceType': infra.get('instanceTypes', ['m5.large'])[0],
            'UserData': user_data_b64,
            'TagSpecifications': [{
                'ResourceType': 'instance',
                'Tags': [
                    {'Key': 'Name', 'Value': f'ImageBuilder-test-{image_arn.split("/")[1]}'},
                    {'Key': 'CreatedBy', 'Value': 'EC2 Image Builder'},
                    {'Key': 'Ec2ImageBuilderArn', 'Value': image_arn},
                ]
            }]
        }

        if infra.get('subnetId'):
            run_params['SubnetId'] = infra['subnetId']
        if infra.get('securityGroupIds'):
            run_params['SecurityGroupIds'] = infra['securityGroupIds']
        if infra.get('instanceProfileName'):
            run_params['IamInstanceProfile'] = {'Name': infra['instanceProfileName']}
        if infra.get('keyPair'):
            run_params['KeyName'] = infra['keyPair']

        # Launch
        run_result = ec2.run_instances(**run_params)
        instance_id = run_result['Instances'][0]['InstanceId']
        print(f'Launched test instance: {instance_id} from AMI: {ami_id}')

        # Wait for running
        waiter = ec2.get_waiter('instance_running')
        waiter.wait(InstanceIds=[instance_id], WaiterConfig={'Delay': 15, 'MaxAttempts': 40})

        # Wait for SSM agent
        for attempt in range(40):
            resp = ssm.describe_instance_information(
                Filters=[{'Key': 'InstanceIds', 'Values': [instance_id]}]
            )
            info_list = resp.get('InstanceInformationList', [])
            if info_list and info_list[0].get('PingStatus') == 'Online':
                print(f'SSM agent online for {instance_id}')
                break
            time.sleep(15)
        else:
            raise Exception(f'SSM agent did not come online for {instance_id}')

        # Resume workflow
        ib.send_workflow_step_action(
            stepExecutionId=step_execution_id,
            imageBuildVersionArn=image_arn,
            action='RESUME',
            reason=instance_id,
        )
        return {'statusCode': 200, 'body': f'Test instance {instance_id} launched'}

    except Exception as e:
        print(f'Error: {e}')
        try:
            ib.send_workflow_step_action(
                stepExecutionId=step_execution_id,
                imageBuildVersionArn=image_arn,
                action='STOP',
                reason=f'Lambda error: {str(e)[:200]}',
            )
        except Exception as stop_err:
            print(f'Failed to send STOP: {stop_err}')
        raise

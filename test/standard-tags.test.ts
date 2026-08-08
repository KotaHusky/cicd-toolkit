import { describe, test, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { applyStandardTags } from '../lib/constructs/standard-tags';

const ENV = { account: '111111111111', region: 'us-east-1' };

function makeStack(id: string) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, id, { env: ENV });
  // Give the stack a taggable resource so applied tags surface in the template.
  new cdk.aws_sns.Topic(stack, 'Topic');
  return stack;
}

describe('applyStandardTags', () => {
  test('applies all provided tags when the required keys are present', () => {
    const stack = makeStack('Good');
    applyStandardTags(stack, {
      Project: 'kiosk',
      Environment: 'production',
      Repository: 'owner/repo',
      Owner: 'platform',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SNS::Topic', {
      Tags: [
        { Key: 'Environment', Value: 'production' },
        { Key: 'Owner', Value: 'platform' },
        { Key: 'Project', Value: 'kiosk' },
        { Key: 'Repository', Value: 'owner/repo' },
      ],
    });
  });

  test('throws when Repository is missing', () => {
    const stack = makeStack('NoRepo');
    expect(() =>
      applyStandardTags(stack, { Project: 'kiosk', Environment: 'production' } as never),
    ).toThrow(/missing required tag\(s\): Repository/);
  });

  test('throws when Project is blank (whitespace only)', () => {
    const stack = makeStack('BlankProject');
    expect(() =>
      applyStandardTags(stack, { Project: '   ', Environment: 'production', Repository: 'owner/repo' }),
    ).toThrow(/missing required tag\(s\): Project/);
  });

  test('lists every missing required tag', () => {
    const stack = makeStack('AllMissing');
    expect(() => applyStandardTags(stack, {} as never)).toThrow(
      /missing required tag\(s\): Project, Environment, Repository/,
    );
  });
});

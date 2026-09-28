import { tableDefinition } from './table.mjs'

const ref = (name) => ({ Ref: name })
const sub = (value) => ({ 'Fn::Sub': value })
const arn = (name) => ({ 'Fn::GetAtt': [name, 'Arn'] })
const providerPath = 'oidc.vercel.com/${VercelTeamSlug}'
export const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'EvaluChess DynamoDB and a Vercel OIDC role scoped to one project and environment.',
  Parameters: {
    TableName: {
      Type: 'String',
      Default: 'evaluchess-production',
      AllowedPattern: '[a-zA-Z0-9_.-]{3,255}',
    },
    VercelTeamSlug: { Type: 'String', AllowedPattern: '[a-zA-Z0-9-]+' },
    VercelProjectName: { Type: 'String', Default: 'evaluchess', AllowedPattern: '[a-zA-Z0-9-]+' },
    VercelEnvironment: {
      Type: 'String',
      Default: 'production',
      AllowedValues: ['production', 'preview'],
    },
    ExistingOidcProviderArn: {
      Type: 'String',
      Default: '',
      Description: 'Reuse an existing TEAM issuer provider if this AWS account already has one.',
    },
  },
  Conditions: { CreateProvider: { 'Fn::Equals': [ref('ExistingOidcProviderArn'), ''] } },
  Resources: {
    Table: {
      Type: 'AWS::DynamoDB::Table',
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: {
        ...tableDefinition(ref('TableName')),
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        DeletionProtectionEnabled: true,
        SSESpecification: { SSEEnabled: true },
      },
    },
    OidcProvider: {
      Type: 'AWS::IAM::OIDCProvider',
      Condition: 'CreateProvider',
      Properties: {
        Url: sub('https://' + providerPath),
        ClientIdList: [sub('https://vercel.com/${VercelTeamSlug}')],
      },
    },
    RuntimeRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        Description: 'EvaluChess runtime only; no table administration or scans.',
        AssumeRolePolicyDocument: {
          'Fn::Sub': [
            JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: 'sts:AssumeRoleWithWebIdentity',
                  Principal: { Federated: '${ProviderArn}' },
                  Condition: {
                    StringEquals: {
                      [providerPath + ':aud']: 'https://vercel.com/${VercelTeamSlug}',
                      [providerPath + ':sub']:
                        'owner:${VercelTeamSlug}:project:${VercelProjectName}:environment:${VercelEnvironment}',
                    },
                  },
                },
              ],
            }),
            {
              ProviderArn: {
                'Fn::If': ['CreateProvider', ref('OidcProvider'), ref('ExistingOidcProviderArn')],
              },
            },
          ],
        },
        Policies: [
          {
            PolicyName: 'EvaluChessTableAccess',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: [
                    'dynamodb:GetItem',
                    'dynamodb:PutItem',
                    'dynamodb:DeleteItem',
                    'dynamodb:Query',
                  ],
                  Resource: [
                    arn('Table'),
                    sub('${Table.Arn}/index/leaderboard'),
                    sub('${Table.Arn}/index/leaderboard-wins'),
                  ],
                },
              ],
            },
          },
        ],
      },
    },
  },
  Outputs: {
    TableName: { Value: ref('Table') },
    Region: { Value: ref('AWS::Region') },
    RuntimeRoleArn: { Value: arn('RuntimeRole') },
  },
}
if (process.argv[1]?.endsWith('/stack.mjs'))
  process.stdout.write(JSON.stringify(template, null, 2) + '\n')

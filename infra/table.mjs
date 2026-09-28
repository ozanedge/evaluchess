export function tableDefinition(TableName) {
  return {
    TableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
      { AttributeName: 'leaderboard', AttributeType: 'S' },
      { AttributeName: 'elo', AttributeType: 'N' },
      { AttributeName: 'wins', AttributeType: 'N' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'leaderboard-wins',
        KeySchema: [
          { AttributeName: 'leaderboard', KeyType: 'HASH' },
          { AttributeName: 'wins', KeyType: 'RANGE' },
        ],
        Projection: {
          ProjectionType: 'INCLUDE',
          NonKeyAttributes: ['value', 'uid', 'username', 'elo'],
        },
      },
      {
        IndexName: 'leaderboard',
        KeySchema: [
          { AttributeName: 'leaderboard', KeyType: 'HASH' },
          { AttributeName: 'elo', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'INCLUDE', NonKeyAttributes: ['value', 'uid', 'username'] },
      },
    ],
  }
}

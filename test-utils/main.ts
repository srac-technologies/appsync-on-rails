import { VelocityTemplate } from 'amplify-appsync-simulator'

const template = new VelocityTemplate({
  content: `
{
  "version": "2017-02-28",
  "value": "$ctx.args.input"
}
` }, {} as any);

console.log(template.render({
  arguments: {
    input: "test"
  },
  source: {}
}, {
  headers: {},
  requestAuthorizationMode: "API_KEY" as any,
}, {
  fieldNodes: []
} as any).result)

import { VelocityTemplate } from 'amplify-appsync-simulator'
import {TemplateResolution}  from '../utils'

describe("TemplateResolution", () => {
  it(`should render safely`, () => {
    expect(new TemplateResolution().withTemplateContent(`{
      "version": "2017-02-28",
      "value": "$ctx.args.input"
    }`).withArguments({input: 'test'}).render().result).toEqual({version: "2017-02-28", value: "test"});
  })
});

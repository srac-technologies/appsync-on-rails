import { VelocityTemplate } from "amplify-appsync-simulator";

export class TemplateResolution<ArgumentType> {
  public templateContent?: string;
  public arguments?: ArgumentType;

  public withTemplateContent(templateContent: string): TemplateResolution<ArgumentType> {
    this.templateContent = templateContent;
    return this;
  }

  public withArguments(args: ArgumentType): TemplateResolution<ArgumentType> {
    this.arguments = args;
    return this;
  }

  public render(): any {
    const template = new VelocityTemplate({
      content: this.templateContent ?? ''
    }, {} as any);

    return template.render({
      arguments: this.arguments ?? {},
      source: {}
    }, {
      headers: {},
      requestAuthorizationMode: "API_KEY" as any,
    }, {
      fieldNodes: []
    } as any)
  }
}

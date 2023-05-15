import { FunctionDirective } from "./function/FunctionDirective";
import { ConnectionDirective } from "./model/ConnectionDirective";
import { ModelDirective } from "./model/ModelDirective";
import { KeyDirective } from "./model/KeyDirective";
import { AuthDirective } from "./auth/AuthDirective";
import { UniqueDirective } from "./model/UniqueDirective";
import { MultiTenancyDirective } from "./model/MultiTenancyDirective";

export default [
  ModelDirective,
  KeyDirective,
  ConnectionDirective,
  FunctionDirective,
  AuthDirective,
  UniqueDirective,
  MultiTenancyDirective
];

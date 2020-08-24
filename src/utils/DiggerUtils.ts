import { DocumentNode, FieldDefinitionNode, NamedTypeNode, ObjectTypeDefinitionNode, TypeNode } from "graphql";

export namespace DiggerUtils {
    export const updateObjectType = (typeName: string) => {
        return (inp: DocumentNode) => {
            return (value: ObjectTypeDefinitionNode) => {
                const preservedOrder = inp.definitions.findIndex(d => d.kind === 'ObjectTypeDefinition' && d.name.value === typeName)
                const filtered = inp.definitions.filter(d => !(d.kind === 'ObjectTypeDefinition' && d.name.value === typeName))
                return {
                    ...inp,
                    definitions: [...filtered.slice(0, preservedOrder), value, ...filtered.slice(preservedOrder)]
                }
            }
        }
    }
    export const removeObjectDirective = (typeName: string, directiveName: string) => {
        return (inp: DocumentNode) => {
            return () => {
                const preservedOrder = inp.definitions.findIndex(d => d.kind === 'ObjectTypeDefinition' && d.name.value === typeName)
                const filtered = inp.definitions.filter(d => !(d.kind === 'ObjectTypeDefinition' && d.name.value === typeName))
                return {
                    ...inp,
                    definitions: [...filtered.slice(0, preservedOrder),
                    {
                        ...inp.definitions[preservedOrder],
                        directives: [...((<ObjectTypeDefinitionNode>inp.definitions[preservedOrder]).directives || []).filter(d => d.name.value !== directiveName)]
                    },
                    ...filtered.slice(preservedOrder)]
                }
            }
        }
    }

    export const removeFieldDirective = (typeName: string, fieldName: string, directiveName: string) => {
        return (inp: DocumentNode) => {
            return () => {
                const preservedOrder = inp.definitions.findIndex(d => d.kind === 'ObjectTypeDefinition' && d.name.value === typeName)
                const filtered = inp.definitions.filter(d => !(d.kind === 'ObjectTypeDefinition' && d.name.value === typeName))
                const fields = (<ObjectTypeDefinitionNode>inp.definitions[preservedOrder]).fields || []
                const preservedFieldOrder = fields.findIndex(f => f.name.value === fieldName)
                const fileteredFields = fields.filter(f => f.name.value !== fieldName)
                return {
                    ...inp,
                    definitions: [...filtered.slice(0, preservedOrder), {
                        ...inp.definitions[preservedOrder],
                        fields: [
                            ...fileteredFields.slice(0, preservedFieldOrder),
                            <FieldDefinitionNode>{
                                ...fields[preservedFieldOrder],
                                directives: [
                                    ...(fields[preservedFieldOrder].directives || []).filter(d => d.name.value !== directiveName)
                                ]
                            },
                            ...fileteredFields.slice(preservedFieldOrder)
                        ]
                    }, ...filtered.slice(preservedOrder + 1)]
                }
            }
        }
    }
    export const updateFieldTypeName = (typeName: string, fieldName: string, replacer: (from: EasyFieldType) => EasyFieldType) => {
        return (inp: DocumentNode) => {
            return () => {
                const preservedOrder = inp.definitions.findIndex(d => d.kind === 'ObjectTypeDefinition' && d.name.value === typeName)
                const filtered = inp.definitions.filter(d => !(d.kind === 'ObjectTypeDefinition' && d.name.value === typeName))
                const fields = (<ObjectTypeDefinitionNode>inp.definitions[preservedOrder]).fields || []
                const preservedFieldOrder = fields.findIndex(f => f.name.value === fieldName)
                const fileteredFields = fields.filter(f => f.name.value !== fieldName)
                const easyType = unTypeEasy(fields[preservedFieldOrder])
                return {
                    ...inp,
                    definitions: [...filtered.slice(0, preservedOrder), {
                        ...inp.definitions[preservedOrder],
                        fields: [
                            ...fileteredFields.slice(0, preservedFieldOrder),
                            <FieldDefinitionNode>{
                                ...fields[preservedFieldOrder],
                                type: typeEasy(replacer(easyType))
                            },
                            ...fileteredFields.slice(preservedFieldOrder)
                        ]
                    }, ...filtered.slice(preservedOrder + 1)]
                }
            }
        }
    }
}

export const typeEasy = (type: EasyFieldType): TypeNode => {
    if (!type.list) {
        if (!type.required) {
            return {
                kind: "NamedType",
                name: {
                    kind: "Name",
                    value: type.baseTypeName
                }
            }
        }
        return {
            kind: "NonNullType",
            type: {
                kind: "NamedType",
                name: {
                    kind: "Name",
                    value: type.baseTypeName
                }
            }
        }
    }

    return type.required ? {
        kind: "NonNullType",
        type: {
            kind: "ListType",
            type: {
                kind: "NamedType",
                name: {
                    kind: "Name",
                    value: type.baseTypeName
                }
            }
        }
    } : {
            kind: "ListType",
            type: {
                kind: "NamedType",
                name: {
                    kind: "Name",
                    value: type.baseTypeName
                }
            }
        }
}

export const unTypeEasy = (type: FieldDefinitionNode) => {
    switch (type.type.kind) {
        case "NamedType":
            return {
                required: false,
                list: false,
                baseTypeName: type.type.name.value
            }
        case "NonNullType":
            switch (type.type.type.kind) {
                case "NamedType":
                    return {
                        required: true,
                        list: false,
                        baseTypeName: type.type.type.name.value
                    }
                case "ListType":
                    return {
                        required: true,
                        list: true,
                        baseTypeName: (<NamedTypeNode>type.type.type.type).name.value
                    }
            }
        case "ListType":
            switch (type.type.type.kind) {
                case "NamedType":
                    return {
                        required: true,
                        list: true,
                        baseTypeName: type.type.type.name.value
                    }
            }
        default:
            throw new Error(JSON.stringify(type))
    }
}

export type EasyFieldType = {
    required: boolean
    list: boolean
    baseTypeName: string
}

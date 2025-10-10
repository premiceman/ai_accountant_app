class Schema {
  constructor(definition, options) {
    this.definition = definition;
    this.options = options;
  }

  index() {
    return this;
  }
}

Schema.Types = {
  ObjectId: class ObjectId {},
};

const mongooseStub = {
  Schema,
  connection: {},
  model(name, schema) {
    const model = function Model(doc) {
      this.doc = doc;
    };
    model.modelName = name;
    model.schema = schema;
    return model;
  },
};

module.exports = mongooseStub;

class Schema {
  constructor(definition, options = {}) {
    this.definition = definition;
    this.options = options;
  }

  index() {
    return this;
  }
}

Schema.Types = {
  ObjectId: function ObjectId(value) {
    this.value = value;
  },
};

function noopAsync() {
  return Promise.resolve();
}

function model() {
  return {
    updateOne: noopAsync,
    create: noopAsync,
    findOneAndUpdate: noopAsync,
    deleteMany: noopAsync,
  };
}

const connection = {
  readyState: 0,
  once() {},
};

module.exports = {
  Schema,
  model,
  Types: { ObjectId: Schema.Types.ObjectId },
  connection,
};

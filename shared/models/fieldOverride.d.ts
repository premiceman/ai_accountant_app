import { Document, Model, Types } from 'mongoose';

export interface FieldOverride extends Document {
  userId: Types.ObjectId;
  docType: string;
  fieldKey: string;
  dataType: 'number' | 'integer' | 'string' | 'dateMMYYYY';
  selectorStrategy: {
    regex?: string | null;
    anchorLabel?: string | null;
    lineRange?: number | null;
    columnHint?: string | null;
    tokenizer?: string | null;
    hints?: string[] | null;
  };
  sampleValue?: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

declare const FieldOverrideModel: Model<FieldOverride>;
export default FieldOverrideModel;

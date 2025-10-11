import mongoose from 'mongoose';
import DocumentInsightModel from '../../../../backend/models/DocumentInsight';
import FieldOverrideModel from '../../../../shared/models/fieldOverride';

export type DocumentInsight = mongoose.InferSchemaType<typeof DocumentInsightModel.schema>;

export const DocumentInsights = DocumentInsightModel;
export const FieldOverride = FieldOverrideModel;

export default {
  DocumentInsights,
  FieldOverride,
};

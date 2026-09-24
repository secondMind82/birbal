import type { DiaryEntry, Entity, Note, Timeline } from '../models/types';

export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  Main: undefined;
  Timeline: undefined;
  Calendar: undefined;
  Entities: undefined;
  Notes: undefined;
  Diary: undefined;
  Settings: undefined;
  Expenses: undefined;
  AddExpense: undefined;
  AddEvent: { timeline?: Timeline } | undefined;
  NewNote: undefined;
  NewEntity: undefined;
  NewDiaryEntry: undefined;
  EditNote: { note: Note };
  EditEntity: { entity: Entity };
  EditTimeline: { timeline: Timeline };
  EditDiary: { entry?: DiaryEntry };
  PreviewNote: { note: Note };
  PreviewEntity: { entity: Entity };
  PreviewTimeline: { timeline: Timeline };
  PreviewDiary: { entry: DiaryEntry };
};

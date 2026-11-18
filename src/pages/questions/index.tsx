import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { API } from '../../api/api';
import '../users/users.css';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { getLocalized } from '../../utils/getLocalized';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useOptions } from '../../hooks/useOptions';
import { formatDate } from '@/utils/date';
import { ActiveBadge } from '@/components/StatusBadge';
import { fetchAllPages } from '@/api/fetchAllPages';

interface TestCourse {
  id: number;
  name_uz: string | null;
  name_ru: string | null;
  name_en: string | null;
}

interface TestLevel {
  id: number;
  name_uz: string | null;
  name_ru: string | null;
  name_en: string | null;
}

interface TestBranch {
  id: number;
  name_uz: string | null;
  name_ru: string | null;
  name_en: string | null;
}

interface Test {
  id: number;
  name: string;
  course_id: number;
  level_id: number;
  branch_id: number;
  questions_count: number;
  pass_percentage: number;
  time_limit: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  course?: TestCourse;
  level?: TestLevel;
  branch?: TestBranch;
}

interface TestsResponse {
  data: Test[];
  current_page: number;
  last_page: number;
  total: number;
}

// Testning ichidagi savollar — `/questions?test_id=` orqali keladi (aynan
// shu endpoint user panelidagi `students-test` sahifasida ham ishlatiladi).
interface QuestionOption {
  id?: number;
  option_text: string;
  is_correct: boolean;
  order: number;
}

type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'text_answer';
type DifficultyLevel = 'easy' | 'medium' | 'hard';

interface TestQuestion {
  id: number;
  question_text: string;
  question_type: QuestionType;
  difficulty_level: DifficultyLevel;
  course_id: number;
  level_id: number;
  test_id?: number;
  is_active: boolean;
  options: QuestionOption[];
  correct_text_answer?: string;
}

interface QuestionsResponse {
  data: TestQuestion[];
}

// PUT /questions/{id} ga yuboriladigan shakl — kurs/daraja/test o'zgarmaydi
// (savol qaysi testga tegishli ekani shu view ichida turadi), faqat matn/
// tur/murakkablik/variantlar tahrirlanadi.
interface QuestionEditData {
  question_text: string;
  question_type: QuestionType;
  difficulty_level: DifficultyLevel;
  course_id: number;
  level_id: number;
  test_id?: number;
  is_active: boolean;
  options: QuestionOption[];
  correct_text_answer: string;
}

interface TestPayload {
  name: string;
  course_id: number | '';
  level_id: number | '';
  branch_id: number | '';
  questions_count: number | '';
  pass_percentage: number | '';
  time_limit: number | '';
  status: 'active' | 'inactive';
}

const emptyForm = (): TestPayload => ({
  name: '',
  course_id: '',
  level_id: '',
  branch_id: '',
  questions_count: '',
  pass_percentage: '',
  time_limit: '',
  status: 'active',
});

const Questions = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('questions');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<number[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [editingItem, setEditingItem] = useState<Test | null>(null);
  const [viewingTest, setViewingTest] = useState<Test | null>(null);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [formData, setFormData] = useState<TestPayload>(emptyForm());

  const resetForm = () => {
    setFormData(emptyForm());
    setEditingItem(null);
  };

  const { data: apiData, isLoading } = useQuery<TestsResponse>({
    queryKey: ['tests'],
    // `/tests` 20 tadan sahifalaydi — eski testlar ham ko'rinishi uchun hammasini yig'amiz.
    queryFn: async () => {
      const all = await fetchAllPages<Test>('/tests');
      return { data: all, current_page: 1, last_page: 1, total: all.length };
    },
    placeholderData: keepPreviousData,
  });

  const { data: coursesData } = useOptions('courses');
  const { data: levelsData } = useOptions('levels');
  const { data: branchesData } = useOptions('branches');

  // Testni ko'rish oynasi ochilganda shu testga tegishli savollarni
  // yuklaydi. `/questions?test_id=` — user panelidagi (o'qituvchi)
  // `students-test` sahifasida ham ishlatiladigan, backendda mavjud
  // endpoint.
  const { data: questionsData, isLoading: questionsLoading } = useQuery<QuestionsResponse>({
    queryKey: ['questions', viewingTest?.id],
    queryFn: async () => {
      const { data } = await API.get('/questions', { params: { test_id: viewingTest?.id } });
      return data;
    },
    enabled: !!viewingTest,
  });
  const viewQuestions = questionsData?.data ?? [];

  // View oynasi ichida savolni tahrirlash — bitta vaqtda faqat bitta
  // savol tahrirlanadi (shu savolning o'zi kartasi ichida forma bo'lib
  // ochiladi).
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [questionEditData, setQuestionEditData] = useState<QuestionEditData | null>(null);

  const startEditQuestion = (q: TestQuestion) => {
    setEditingQuestionId(q.id);
    setQuestionEditData({
      question_text: q.question_text,
      question_type: q.question_type,
      difficulty_level: q.difficulty_level,
      course_id: q.course_id,
      level_id: q.level_id,
      test_id: q.test_id ?? viewingTest?.id,
      is_active: q.is_active,
      options: q.options.map((o) => ({ ...o })),
      correct_text_answer: q.correct_text_answer || '',
    });
  };

  const cancelEditQuestion = () => {
    setEditingQuestionId(null);
    setQuestionEditData(null);
  };

  const handleQuestionTypeChange = (type: QuestionType) => {
    if (!questionEditData) return;
    const base = { ...questionEditData, question_type: type };
    if (type === 'text_answer') {
      base.options = [];
    } else if (type === 'true_false') {
      base.options = [
        { option_text: 'Ha', is_correct: true, order: 1 },
        { option_text: "Yo'q", is_correct: false, order: 2 },
      ];
    } else if (base.options.length < 2) {
      base.options = [
        { option_text: '', is_correct: false, order: 1 },
        { option_text: '', is_correct: false, order: 2 },
      ];
    }
    setQuestionEditData(base);
  };

  const addQuestionOption = () => {
    if (!questionEditData) return;
    const newOrder = questionEditData.options.length + 1;
    setQuestionEditData({
      ...questionEditData,
      options: [...questionEditData.options, { option_text: '', is_correct: false, order: newOrder }],
    });
  };

  const removeQuestionOption = (index: number) => {
    if (!questionEditData) return;
    setQuestionEditData({
      ...questionEditData,
      options: questionEditData.options.filter((_, i) => i !== index),
    });
  };

  const toggleOptionCorrect = (index: number) => {
    if (!questionEditData) return;
    const newOptions = questionEditData.options.map((o) => ({ ...o }));
    if (
      questionEditData.question_type === 'single_choice' ||
      questionEditData.question_type === 'true_false'
    ) {
      newOptions.forEach((o, i) => (o.is_correct = i === index));
    } else {
      newOptions[index].is_correct = !newOptions[index].is_correct;
    }
    setQuestionEditData({ ...questionEditData, options: newOptions });
  };

  const updateQuestionMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: QuestionEditData }) => {
      const { data } = await API.put(`/questions/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions', viewingTest?.id] });
      cancelEditQuestion();
    },
  });

  const submitQuestionEdit = () => {
    if (editingQuestionId == null || !questionEditData) return;
    updateQuestionMutation.mutate({ id: editingQuestionId, payload: questionEditData });
  };

  const questionTypeLabel = (type: QuestionType) => {
    switch (type) {
      case 'single_choice':
        return t('questions.viewModal.singleChoice');
      case 'multiple_choice':
        return t('questions.viewModal.multipleChoice');
      case 'true_false':
        return t('questions.viewModal.trueFalse');
      default:
        return t('questions.viewModal.textAnswer');
    }
  };

  const difficultyLabel = (level: DifficultyLevel) => {
    switch (level) {
      case 'easy':
        return t('questions.viewModal.easy');
      case 'hard':
        return t('questions.viewModal.hard');
      default:
        return t('questions.viewModal.medium');
    }
  };

  const courses = coursesData || [];
  const levels = levelsData || [];
  const branches = branchesData || [];

  const createMutation = useMutation({
    mutationFn: async (payload: TestPayload) => {
      const { data } = await API.post('/tests', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tests'] });
      setShowModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: TestPayload }) => {
      const { data } = await API.put(`/tests/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tests'] });
      setShowModal(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/tests/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tests'] });
    },
  });

  const filtered = useMemo(() => {
    const tests = apiData?.data || [];
    return tests
      .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
      .filter((t) => !branchFilter || String(t.branch_id) === branchFilter)
      .filter((t) => !courseFilter || String(t.course_id) === courseFilter)
      .filter((t) => !levelFilter || String(t.level_id) === levelFilter)
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  }, [apiData?.data, search, branchFilter, courseFilter, levelFilter, sortAsc]);

  const toggleAll = (checked: boolean) => setSelected(checked ? filtered.map((t) => t.id) : []);

  const toggleOne = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const openEditModal = (item: Test) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      course_id: item.course_id,
      level_id: item.level_id,
      branch_id: item.branch_id,
      questions_count: item.questions_count,
      pass_percentage: item.pass_percentage,
      time_limit: item.time_limit,
      status: item.status,
    });
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, payload: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    } else if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((p) => p.filter((x) => x !== deleteTarget));
    }
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <section className="users container">
      <h1 className="main-title">{t('questions.title')}</h1>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 600, width: '100%' }}>
            <h3 className="modal-title">
              {editingItem ? t('questions.modal.editTitle') : t('questions.modal.createTitle')}
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('questions.modal.nameLabel')}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('questions.modal.namePlaceholder')}
                />
              </div>

              <div className="form-group">
                <label>{t('questions.modal.courseLabel')}</label>
                <select
                  value={formData.course_id}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      course_id: e.target.value ? Number(e.target.value) : '',
                    })
                  }
                >
                  <option value="">{t('questions.modal.selectPlaceholder')}</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>{t('questions.modal.levelLabel')}</label>
                <select
                  value={formData.level_id}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      level_id: e.target.value ? Number(e.target.value) : '',
                    })
                  }
                >
                  <option value="">{t('questions.modal.selectPlaceholder')}</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>{t('questions.modal.branchLabel')}</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      branch_id: e.target.value ? Number(e.target.value) : '',
                    })
                  }
                >
                  <option value="">{t('questions.modal.selectPlaceholder')}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>{t('questions.modal.questionsCountLabel')}</label>
                <input
                  type="number"
                  min={1}
                  value={formData.questions_count}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      questions_count: e.target.value ? Number(e.target.value) : '',
                    })
                  }
                  placeholder={t('questions.modal.questionsCountPlaceholder')}
                />
              </div>

              <div className="form-group">
                <label>{t('questions.modal.passPercentageLabel')}</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={formData.pass_percentage}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      pass_percentage: e.target.value ? Number(e.target.value) : '',
                    })
                  }
                  placeholder={t('questions.modal.passPercentagePlaceholder')}
                />
              </div>

              <div className="form-group">
                <label>{t('questions.modal.timeLimitLabel')}</label>
                <input
                  type="number"
                  min={1}
                  value={formData.time_limit}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      time_limit: e.target.value ? Number(e.target.value) : '',
                    })
                  }
                  placeholder={t('questions.modal.timeLimitPlaceholder')}
                />
              </div>

              <div className="form-group">
                <label>{t('questions.modal.statusLabel')}</label>
                <div className="toggle-buttons">
                  <button
                    type="button"
                    className={formData.status === 'inactive' ? 'active' : ''}
                    onClick={() => setFormData({ ...formData, status: 'inactive' })}
                  >
                    {t('questions.statusInactive')}
                  </button>
                  <button
                    type="button"
                    className={formData.status === 'active' ? 'active' : ''}
                    onClick={() => setFormData({ ...formData, status: 'active' })}
                  >
                    {t('questions.statusActive')}
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="primary"
                onClick={handleSubmit}
                disabled={isPending || !formData.name.trim()}
              >
                {isPending ? t('questions.modal.saving') : t('questions.modal.save')}
              </button>
              <button
                className="cancel"
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
              >
                {t('questions.modal.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('questions.deleteModal.title')}</h3>
            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('questions.deleteModal.confirm')}
              </button>
              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('questions.deleteModal.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingTest && (
        <div
          className="modal-overlay"
          onClick={() => {
            setViewingTest(null);
            cancelEditQuestion();
          }}
        >
          <div
            className="modal"
            style={{ maxWidth: 700, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">
              {viewingTest.name} — {t('questions.viewModal.title')}
            </h3>

            {questionsLoading ? (
              <p style={{ textAlign: 'center', color: '#7a8fa6' }}>
                {t('questions.viewModal.loading')}
              </p>
            ) : viewQuestions.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#7a8fa6' }}>
                {t('questions.viewModal.empty')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {viewQuestions.map((q, idx) => {
                  const isEditingThis = editingQuestionId === q.id;
                  return (
                    <div
                      key={q.id}
                      style={{
                        border: `1.5px solid ${isEditingThis ? '#003366' : '#dde1e7'}`,
                        borderRadius: 10,
                        padding: '14px 16px',
                      }}
                    >
                      {isEditingThis && questionEditData ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div className="form-group">
                            <label>{t('questions.viewModal.questionTextLabel')}</label>
                            <input
                              type="text"
                              value={questionEditData.question_text}
                              onChange={(e) =>
                                setQuestionEditData({
                                  ...questionEditData,
                                  question_text: e.target.value,
                                })
                              }
                            />
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div className="form-group">
                              <label>{t('questions.viewModal.difficultyLevelLabel')}</label>
                              <select
                                value={questionEditData.difficulty_level}
                                onChange={(e) =>
                                  setQuestionEditData({
                                    ...questionEditData,
                                    difficulty_level: e.target.value as DifficultyLevel,
                                  })
                                }
                              >
                                <option value="easy">{t('questions.viewModal.easy')}</option>
                                <option value="medium">{t('questions.viewModal.medium')}</option>
                                <option value="hard">{t('questions.viewModal.hard')}</option>
                              </select>
                            </div>
                            <div className="form-group">
                              <label>{t('questions.viewModal.questionTypeLabel')}</label>
                              <select
                                value={questionEditData.question_type}
                                onChange={(e) =>
                                  handleQuestionTypeChange(e.target.value as QuestionType)
                                }
                              >
                                <option value="single_choice">
                                  {t('questions.viewModal.singleChoice')}
                                </option>
                                <option value="multiple_choice">
                                  {t('questions.viewModal.multipleChoice')}
                                </option>
                                <option value="true_false">
                                  {t('questions.viewModal.trueFalse')}
                                </option>
                                <option value="text_answer">
                                  {t('questions.viewModal.textAnswer')}
                                </option>
                              </select>
                            </div>
                          </div>

                          {questionEditData.question_type === 'text_answer' ? (
                            <div className="form-group">
                              <label>{t('questions.viewModal.correctAnswer')}</label>
                              <input
                                type="text"
                                value={questionEditData.correct_text_answer}
                                onChange={(e) =>
                                  setQuestionEditData({
                                    ...questionEditData,
                                    correct_text_answer: e.target.value,
                                  })
                                }
                              />
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {questionEditData.options.map((opt, optIdx) => (
                                <div
                                  key={optIdx}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                                >
                                  <button
                                    type="button"
                                    title={t('questions.viewModal.correctAnswer')}
                                    onClick={() => toggleOptionCorrect(optIdx)}
                                    style={{
                                      width: 22,
                                      height: 22,
                                      borderRadius: '50%',
                                      border: `1.5px solid ${opt.is_correct ? '#1bb200' : '#dde1e7'}`,
                                      background: opt.is_correct ? '#1bb200' : '#fff',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {opt.is_correct && (
                                      <i
                                        className="fa fa-check"
                                        style={{ color: '#fff', fontSize: 10 }}
                                      />
                                    )}
                                  </button>
                                  <input
                                    type="text"
                                    style={{ flex: 1 }}
                                    value={opt.option_text}
                                    readOnly={questionEditData.question_type === 'true_false'}
                                    placeholder={`${t('questions.viewModal.optionLabel')} ${optIdx + 1}`}
                                    onChange={(e) => {
                                      const newOptions = [...questionEditData.options];
                                      newOptions[optIdx] = {
                                        ...newOptions[optIdx],
                                        option_text: e.target.value,
                                      };
                                      setQuestionEditData({
                                        ...questionEditData,
                                        options: newOptions,
                                      });
                                    }}
                                  />
                                  {questionEditData.question_type !== 'true_false' &&
                                    questionEditData.options.length > 2 && (
                                      <button
                                        type="button"
                                        onClick={() => removeQuestionOption(optIdx)}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          color: '#e03131',
                                          cursor: 'pointer',
                                          fontSize: 14,
                                          flexShrink: 0,
                                        }}
                                      >
                                        <i className="fa-solid fa-xmark" />
                                      </button>
                                    )}
                                </div>
                              ))}
                              {questionEditData.question_type !== 'true_false' && (
                                <button
                                  type="button"
                                  className="cancel"
                                  style={{ alignSelf: 'flex-start', padding: '6px 14px' }}
                                  onClick={addQuestionOption}
                                >
                                  {t('questions.viewModal.addOption')}
                                </button>
                              )}
                            </div>
                          )}

                          <div className="modal-actions" style={{ margin: 0 }}>
                            <button
                              className="primary"
                              onClick={submitQuestionEdit}
                              disabled={
                                updateQuestionMutation.isPending ||
                                !questionEditData.question_text.trim()
                              }
                            >
                              {updateQuestionMutation.isPending
                                ? t('questions.modal.saving')
                                : t('questions.modal.save')}
                            </button>
                            <button className="cancel" onClick={cancelEditQuestion}>
                              {t('questions.modal.cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              gap: 12,
                              marginBottom: 10,
                            }}
                          >
                            <span style={{ fontFamily: 'noto-sb, sans-serif', color: '#1a2332' }}>
                              {idx + 1}. {q.question_text}
                            </span>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                flexShrink: 0,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 12,
                                  color: '#4b5563',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {questionTypeLabel(q.question_type)} ·{' '}
                                {difficultyLabel(q.difficulty_level)}
                              </span>
                              <Protected permission="questions.edit">
                                <button
                                  className="user-edit-btn"
                                  title={t('questions.viewModal.edit')}
                                  onClick={() => startEditQuestion(q)}
                                >
                                  <i className="fa-solid fa-pen" />
                                </button>
                              </Protected>
                            </div>
                          </div>

                          {q.question_type === 'text_answer' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontFamily: 'noto-sb, sans-serif', color: '#4b5563' }}>
                                {t('questions.viewModal.correctAnswer')}:
                              </span>
                              <span style={{ color: '#1bb200', fontFamily: 'noto-b' }}>
                                {q.correct_text_answer}
                              </span>
                            </div>
                          ) : (
                            <ul
                              style={{
                                margin: 0,
                                padding: 0,
                                listStyle: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                              }}
                            >
                              {q.options.map((opt, optIdx) => (
                                <li
                                  key={opt.id ?? optIdx}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '6px 12px',
                                    borderRadius: 6,
                                    background: opt.is_correct ? '#e6f9ec' : '#fff',
                                    border: `1px solid ${opt.is_correct ? '#1bb200' : '#dee2e6'}`,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 20,
                                      height: 20,
                                      borderRadius: '50%',
                                      background: opt.is_correct ? '#1bb200' : '#dee2e6',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                    }}
                                  >
                                    {opt.is_correct && (
                                      <i
                                        className="fa fa-check"
                                        style={{ color: '#fff', fontSize: 10 }}
                                      />
                                    )}
                                  </span>
                                  <span
                                    style={{
                                      color: opt.is_correct ? '#1bb200' : '#495057',
                                      fontFamily: opt.is_correct ? 'noto-b' : 'noto-r, sans-serif',
                                    }}
                                  >
                                    {opt.option_text}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="cancel"
                onClick={() => {
                  setViewingTest(null);
                  cancelEditQuestion();
                }}
              >
                {t('questions.viewModal.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="users-filters">
        <Protected permission="questions.create">
          <button
            className="add-new-user"
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
          >
            {t('questions.addBtn')}
          </button>
        </Protected>

        <Protected permission="questions.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('questions.deleteBtn')}
          </button>
        </Protected>

        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="">{t('questions.modal.branchLabel')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>

        <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
          <option value="">{t('questions.table.course')}</option>
          {courses?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          <option value="">{t('questions.table.level')}</option>
          {levels?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>

        <input placeholder={t('questions.search')} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="users-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === filtered.length && filtered.length > 0}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              {isVisible('id') && (
                <th className="th-sortable" onClick={() => setSortAsc((p) => !p)}>
                  ID {sortAsc ? '↑' : '↓'}
                </th>
              )}
              {visibleColumns.map((colId) => (
                <th key={colId}>{columnHeader(colId)}</th>
              ))}
              <th>{t('questions.table.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : filtered.length > 0 ? (
              filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleOne(item.id)}
                    />
                  </td>
                  {isVisible('id') && <td>{item.id}</td>}
                  {visibleColumns.map((colId) => {
                    switch (colId) {
                      case 'name':
                        return <td key={colId}>{item.name}</td>;
                      case 'course':
                        return (
                          <td key={colId}>
                            {item.course ? getLocalized(item.course, 'name', i18n.language) : '-'}
                          </td>
                        );
                      case 'level':
                        return (
                          <td key={colId}>
                            {item.level ? getLocalized(item.level, 'name', i18n.language) : '-'}
                          </td>
                        );
                      case 'date':
                        return (
                          <td key={colId}>
                            {formatDate(item.created_at, '-')}
                          </td>
                        );
                      case 'time_limit':
                        return (
                          <td key={colId}>
                            {item.time_limit
                              ? `${item.time_limit} ${t('questions.timeLimitUnit')}`
                              : '-'}
                          </td>
                        );
                      case 'pass_percentage':
                        return (
                          <td key={colId}>
                            {item.pass_percentage != null ? `${item.pass_percentage}%` : '-'}
                          </td>
                        );
                      case 'questions_count':
                        return <td key={colId}>{item.questions_count ?? '-'}</td>;
                      case 'branch':
                        return (
                          <td key={colId}>
                            {item.branch ? getLocalized(item.branch, 'name', i18n.language) : '-'}
                          </td>
                        );
                      case 'status':
                        return (
                  <td key={colId}>
                    <ActiveBadge
                      active={item.status === 'active'}
                      activeLabel={t('questions.statusActive')}
                      inactiveLabel={t('questions.statusInactive')}
                    />
                  </td>
                        );
                      default:
                        return <td key={colId}>-</td>;
                    }
                  })}
                  <td className="actions">
                    <Protected permission="questions.show">
                      <button className="user-view-btn" onClick={() => setViewingTest(item)}>
                        <i className="fa-solid fa-eye" />
                      </button>
                    </Protected>
                    <Protected permission="questions.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                        <i className="fa-solid fa-pen" />
                      </button>
                    </Protected>
                    <Protected permission="questions.delete">
                      <button
                        className="user-delete-btn"
                        onClick={() => {
                          setDeleteTarget(item.id);
                          setShowDeleteModal(true);
                        }}
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('questions.notFound')} />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default Questions;

// App.jsx
import './App.css';
import { useState, useCallback, useEffect, useRef } from 'react';
import { FaRegImage, FaUpload, FaTrash, FaTimes, FaCheckCircle } from 'react-icons/fa';
import axios from 'axios';

// For Render backend:
axios.defaults.baseURL = 'https://file-analyzer-backend-gev9.onrender.com';
// For local testing, you can temporarily use:
// axios.defaults.baseURL = 'http://localhost:3000';

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <Home />
    </div>
  );
}

const Home = () => {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [selectedErrorIndex, setSelectedErrorIndex] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingAnalyse, setLoadingAnalyse] = useState(false);

  const fileInputRef = useRef(null);
  const filesRef = useRef([]);

  const prepareFilePreview = async (file) => {
    const fileObj = { file, name: file.name, size: file.size };

    if (file.type?.startsWith('image/')) {
      fileObj.kind = 'image';
      fileObj.preview = URL.createObjectURL(file);
      return fileObj;
    }

    if (file.type?.startsWith('text/') || /\.(md|txt|json|csv|log|xml)$/i.test(file.name)) {
      fileObj.kind = 'text';
      try {
        const text = await file.text();
        fileObj.text = text;
      } catch {
        fileObj.text = 'Could not read file as text.';
      }
      return fileObj;
    }

    fileObj.kind = 'other';
    return fileObj;
  };

  const traverseFileTree = (entry, path = '') =>
    new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(
          (file) => {
            file.fullPath = path + file.name;
            resolve([file]);
          },
          () => resolve([]),
        );
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = [];
        const readEntries = () => {
          reader.readEntries(async (results) => {
            if (!results.length) {
              const promises = entries.map((e) => traverseFileTree(e, path + entry.name + '/'));
              const nested = await Promise.all(promises);
              resolve(nested.flat());
            } else {
              entries.push(...results);
              readEntries();
            }
          });
        };
        readEntries();
      } else {
        resolve([]);
      }
    });

  const getFilesFromDataTransferItems = async (items) => {
    const supportsEntry =
      typeof items?.[0]?.webkitGetAsEntry === 'function' ||
      typeof items?.[0]?.getAsEntry === 'function';

    if (supportsEntry) {
      const entryPromises = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const getEntry = item.webkitGetAsEntry || item.getAsEntry;
        if (!getEntry) continue;
        const entry = getEntry.call(item);
        if (entry) entryPromises.push(traverseFileTree(entry));
      }
      const nested = await Promise.all(entryPromises);
      const files = nested.flat();
      return files.filter(Boolean);
    }

    const fallbackFiles = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file') {
        const file = it.getAsFile ? it.getAsFile() : null;
        if (file) fallbackFiles.push(file);
      }
    }
    return fallbackFiles;
  };

  const processFiles = useCallback(
    async (fileList) => {
      if (!fileList || fileList.length === 0) return;
      const arr = Array.from(fileList);
      const prepared = await Promise.all(arr.map((f) => prepareFilePreview(f)));
      setFiles((prev) => [...prev, ...prepared]);
    },
    [setFiles],
  );

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const dt = e.dataTransfer;
    if (dt && dt.items && dt.items.length) {
      try {
        const filesFromItems = await getFilesFromDataTransferItems(dt.items);
        if (filesFromItems && filesFromItems.length) {
          await processFiles(filesFromItems);
          return;
        }
      } catch {
        // fallback
      }
    }

    if (dt && dt.files && dt.files.length) {
      await processFiles(dt.files);
    }
  };

  const handleFileSelect = async (e) => {
    const inputEl = (e && (e.currentTarget || e.target)) || fileInputRef.current;
    if (!inputEl) return;

    const fileList = inputEl.files;
    if (!fileList || fileList.length === 0) return;

    await processFiles(fileList);

    try {
      inputEl.value = '';
    } catch (err) {
      console.debug('Could not clear file input value', err);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const clearAll = () => {
    files.forEach((f) => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setFiles([]);
    setPreview(null);
    setSelectedErrorIndex(null);
    setAnalysis(null);
  };

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []);

  const removeFile = (index) => {
    setFiles((prev) => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  };

  /**
   * PREVIEW:
   * - Read text in browser (already in f.text)
   * - Send JSON { filename, text } to /preview
   * - No multipart/form-data
   */
  const Preview = async () => {
    if (!files.length) {
      alert('No file selected for preview.');
      return;
    }

    const target = files[0];

    if (target.kind !== 'text') {
      alert('Preview currently supports only text / log files.');
      return;
    }
    if (!target.text) {
      alert('Could not read file content.');
      return;
    }

    setPreview(null);
    setSelectedErrorIndex(null);
    setAnalysis(null);
    setLoadingPreview(true);

    try {
      const res = await axios.post('/preview', {
        filename: target.name,
        text: target.text,
      });

      // expected: { totalErrors, errors: [{ line_number, raw_text, redacted_text }, ...] }
      setPreview(res.data);
      if (res.data?.errors && res.data.errors.length) setSelectedErrorIndex(0);
    } catch (err) {
      console.error(err);
      alert('Error generating preview. See console for details.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const AnalyseSelected = async () => {
    if (!preview?.errors || selectedErrorIndex === null) {
      alert('No error selected to analyse.');
      return;
    }

    const redacted_text = preview.errors[selectedErrorIndex].redacted_text;
    if (!redacted_text) {
      alert('Selected error has no redacted text.');
      return;
    }

    setAnalysis(null);
    setLoadingAnalyse(true);

    try {
      const res = await axios.post('/analyze', { redacted_text });
      setAnalysis(res.data);
    } catch (err) {
      console.error(err);
      alert('Error analysing selected error. See console for details.');
    } finally {
      setLoadingAnalyse(false);
    }
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto text-center">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">File Analyzer</h1>
          <p className="text-slate-600">Upload, preview, and analyze your files with AI-powered insights</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Section */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-800">Upload Files</h2>
              </div>

              <div className="p-6">
                <div
                  className={`relative border-3 border-dashed rounded-xl p-8 transition-all duration-200 ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50 scale-105'
                      : 'border-slate-300 bg-slate-50 hover:border-slate-400'
                  }`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="flex flex-col items-center justify-center text-center space-y-4">
                    <div className={`p-4 rounded-full ${isDragging ? 'bg-blue-100' : 'bg-slate-200'}`}>
                      <FaRegImage size={32} className={isDragging ? 'text-blue-600' : 'text-slate-500'} />
                    </div>

                    <div>
                      <p className="text-slate-700 font-medium mb-1">Drop files or folders here</p>
                      <p className="text-sm text-slate-500">Supports images, text, and more</p>
                    </div>

                    <button
                      type="button"
                      className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FaUpload size={16} />
                      Choose Files
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,text/*,.txt,.md,.json,.csv,.log,.xml"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </div>
                </div>

                <button
                  onClick={Preview}
                  className="w-full mt-6 px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg font-medium hover:from-violet-700 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={files.length === 0 || loadingPreview}
                >
                  {loadingPreview ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin">⏳</span>
                      Generating Preview...
                    </span>
                  ) : (
                    'Generate Preview'
                  )}
                </button>

                {/* Selected Files */}
                {files.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-700">
                        Selected Files ({files.length})
                      </h3>
                      <button
                        onClick={clearAll}
                        className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"
                        disabled={files.length === 0}
                      >
                        <FaTrash size={10} />
                        Clear All
                      </button>
                    </div>

                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {files.map((f, idx) => (
                        <div
                          key={idx}
                          className="bg-slate-50 rounded-lg p-3 border border-slate-200 hover:border-slate-300 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            {f.kind === 'image' ? (
                              <img src={f.preview} alt={f.name} className="w-12 h-12 object-cover rounded" />
                            ) : (
                              <div className="w-12 h-12 flex items-center justify-center bg-slate-200 rounded text-xs font-medium text-slate-600">
                                {f.kind.toUpperCase()}
                              </div>
                            )}

                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-slate-800 truncate">{f.name}</div>
                              <div className="text-xs text-slate-500">{(f.size / 1024).toFixed(1)} KB</div>
                            </div>

                            <button
                              onClick={() => removeFile(idx)}
                              className="p-2 hover:bg-red-50 rounded-lg transition-colors text-slate-400 hover:text-red-600"
                            >
                              <FaTimes size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Preview & Analysis Section */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden h-full flex flex-col">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">Preview & Analysis</h2>
                <button
                  onClick={AnalyseSelected}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg font-medium hover:from-violet-700 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!preview || !preview.errors || selectedErrorIndex === null || loadingAnalyse}
                >
                  {loadingAnalyse ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Analysing...
                    </>
                  ) : (
                    <>
                      <FaCheckCircle size={16} />
                      Analyse Selected
                    </>
                  )}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Server Preview */}
                <div>
                  <h3 className="text-md font-semibold text-slate-800 mb-3">Detected Errors</h3>
                  {preview ? (
                    <div className="space-y-3">
                      <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                        Total: {preview.totalErrors} {preview.totalErrors === 1 ? 'error' : 'errors'}
                      </div>

                      <div className="space-y-2">
                        {preview.errors.map((e, i) => (
                          <div
                            key={i}
                            onClick={() => setSelectedErrorIndex(i)}
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                              selectedErrorIndex === i
                                ? 'border-violet-500 bg-violet-50 shadow-md'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                            }`}
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-medium text-slate-500">Line {e.line_number}</span>
                              <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-medium">
                                #{i + 1}
                              </span>
                            </div>
                            <pre className="whitespace-pre-wrap text-sm text-slate-700 font-mono">
                              {e.redacted_text}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-slate-500">
                      <FaRegImage size={48} className="mx-auto mb-3 text-slate-300" />
                      <p>No preview available. Upload and generate preview to see results.</p>
                    </div>
                  )}
                </div>

                {/* Analysis Result */}
                {analysis && (
                  <div>
                    <h3 className="text-md font-semibold text-slate-800 mb-3">Analysis Result</h3>

                    <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-5 border border-violet-200 shadow-sm">
                      <div className="space-y-3">
                        {/* SOURCE */}
                        <div className="grid grid-cols-4 gap-3 items-center">
                          <div className="col-span-1 text-xs font-bold text-violet-700 bg-violet-200/80 px-3 py-2 rounded-lg flex items-center justify-center">
                            SOURCE
                          </div>
                          <div className="col-span-3 text-sm text-slate-800 font-medium">
                            {analysis.analysis?.source || analysis.source || 'N/A'}
                          </div>
                        </div>

                        {/* TYPE */}
                        <div className="grid grid-cols-4 gap-3 items-center">
                          <div className="col-span-1 text-xs font-bold text-blue-700 bg-blue-200/80 px-3 py-2 rounded-lg flex items-center justify-center">
                            TYPE
                          </div>
                          <div className="col-span-3 text-sm text-slate-800 font-medium">
                            {analysis.analysis?.issue_type || 'N/A'}
                          </div>
                        </div>

                        {/* CAUSE */}
                        <div className="grid grid-cols-4 gap-3 items-center">
                          <div className="col-span-1 text-xs font-bold text-red-700 bg-red-200/80 px-3 py-2 rounded-lg flex items-center justify-center">
                            CAUSE
                          </div>
                          <div className="col-span-3 text-sm text-slate-800">
                            {analysis.analysis?.root_cause || 'N/A'}
                          </div>
                        </div>

                        {/* FIX */}
                        <div className="grid grid-cols-4 gap-3 items-center">
                          <div className="col-span-1 text-xs font-bold text-green-700 bg-green-200/80 px-3 py-2 rounded-lg flex items-center justify-center">
                            FIX
                          </div>
                          <div className="col-span-3 text-sm text-slate-800">
                            {analysis.analysis?.suggested_fix || 'N/A'}
                          </div>
                        </div>

                        {/* SEVERITY / CONFIDENCE */}
                        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-violet-200 mt-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-orange-700 bg-orange-200/80 px-3 py-2 rounded-lg">
                              SEVERITY
                            </span>
                            <span className="text-sm text-slate-800 font-medium">
                              {analysis.analysis?.severity || 'N/A'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-cyan-700 bg-cyan-200/80 px-3 py-2 rounded-lg">
                              CONFIDENCE
                            </span>
                            <span className="text-sm text-slate-800 font-medium">
                              {analysis.analysis?.confidence || 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

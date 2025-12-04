import './App.css';
import { useState, useCallback } from 'react';
import { FaRegImage } from 'react-icons/fa';
import axios from 'axios';

/**
 * NOTES:
 * - Folder drag (recursive) relies on webkitGetAsEntry / getAsEntry support (Chromium, Safari).
 * - Firefox doesn't support folder entries; it will fall back to DataTransfer.files.
 * - Large files: consider rejecting based on size if needed.
 */

function App() {
  return (
    <div className="p-10 flex h-screen w-screen">
      <Home />
    </div>
  );
}

const Home = () => {
  // files: array of { file, kind: 'image'|'text'|'other', preview?, text? }
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [analysedResults, setAnalysedResults] = useState(null);
  const [preview,setPreview] = useState(null);

  // Helper to read a File into our preview structure
  const Analyse=async()=>{
    alert("Analysing File...");
    try{
      const res=await axios.post('http://localhost:5000/analyse',{file:files[0].text
      });
      setAnalysedResults(res.data);
      alert("Analysis Complete!");
    }
    catch(err){
      alert("Error analysing file.");
    }


  }
  const Preview=async()=>{
    alert("Generating Preview...");
    
    try{
      const res=await axios.post('http://localhost:5000/preview',{file:files[0].text
      });
      setPreview(res.data);
      alert("Preview Generated!");
    }
    catch(err){
      alert("Error generating preview.");
    }
  }
  const prepareFilePreview = async (file) => {
    const fileObj = { file, name: file.name, size: file.size };

    if (file.type.startsWith('image/')) {
      fileObj.kind = 'image';
      fileObj.preview = URL.createObjectURL(file);
      return fileObj;
    }

    // treat text-like as text (type may be empty for some files)
    if (file.type.startsWith('text/') || /\.(md|txt|json|csv|log|xml)$/i.test(file.name)) {
      fileObj.kind = 'text';
      try {
        const text = await file.text(); // modern API, returns Promise
        fileObj.text = text;
      } catch {
        fileObj.text = 'Could not read file as text.';
      }
      return fileObj;
    }

    fileObj.kind = 'other';
    return fileObj;
  };


  // Recursively traverse an entry (file or directory) to collect File objects.
  const traverseFileTree = (entry, path = '') =>
    new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(
          (file) => {
            file.fullPath = path + file.name; // optional: keep path
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
              // no more entries; traverse collected entries
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

  // Convert DataTransferItemList into File[] (supports folders via webkitGetAsEntry)
  const getFilesFromDataTransferItems = async (items) => {
    // If browser supports getAsEntry / webkitGetAsEntry, use it
    const supportsEntry = typeof items?.[0]?.webkitGetAsEntry === 'function' || typeof items?.[0]?.getAsEntry === 'function';

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
      // Filter out directories (shouldn't happen) and ensure File instances
      return files.filter(Boolean);
    }

    // Fallback: use DataTransfer.files
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

  // Main handler to process dropped or selected files
  const processFiles = useCallback(
    async (fileList) => {
      if (!fileList || fileList.length === 0) return;

      // Convert FileList -> array
      const arr = Array.from(fileList);
      // Prepare previews in parallel
      const prepared = await Promise.all(arr.map((f) => prepareFilePreview(f)));
      // Append to existing files
      setFiles((prev) => [...prev, ...prepared]);
    },
    [setFiles],
  );

  // Handler for drop event (supports folders)
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Prefer items (to support folders), otherwise fallback to files
    const dt = e.dataTransfer;
    if (dt && dt.items && dt.items.length) {
      try {
        const filesFromItems = await getFilesFromDataTransferItems(dt.items);
        if (filesFromItems && filesFromItems.length) {
          await processFiles(filesFromItems);
          return;
        }
      } catch (err) {
        // ignore and fallback
      }
    }

    if (dt && dt.files && dt.files.length) {
      await processFiles(dt.files);
    }
  };

  // file input select fallback
  const handleFileSelect = async (e) => {
    const file = e.target.files;
    await processFiles(file);
    e.currentTarget.value = ''; // allow selecting same file again if needed
  };

  // drag handlers
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
    // Only disable dragging when leaving the drop zone (not when entering children).
    // A simple approach: set false on dragleave (works well enough)
    setIsDragging(false);
  };

  // Clear all previews and revoke object URLs
  const clearAll = () => {
    files.forEach((f) => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setFiles([]);
  };

  // Remove a single file
  const removeFile = (index) => {
    setFiles((prev) => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  };

  return (
    <div className="flex flex-col w-full h-full items-center mx-auto gap-6">
      <h1 className="text-lg font-semibold"></h1>

      <div className="flex w-full h-full gap-5">
        {/* Left: Drag zone */}
        <div
          className={`flex flex-col w-1/3 h-1/2 gap-4 rounded p-4 border transition-colors ${
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
          }`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex flex-col  items-center justify-center py-6 cursor-pointer">
            <FaRegImage size={48} className="text-gray-400" />
            <p className="mt-2 text-sm text-gray-700">Drop files/folders here</p>

            <label className="mt-4 inline-block bg-blue-600 text-white px-4 py-2 rounded-md cursor-pointer hover:bg-blue-700">
              Choose files
              <input
                type="file"
                multiple
                accept="image/*,text/*,.txt,.md,.json,.csv,.log"
                className="hidden"
                onChange={handleFileSelect}
                // Note: input cannot pick folders in all browsers; you could add webkitdirectory prop for folder selection in Chromium:
                // webkitdirectory="true" directory=""
              />
            </label>
            <button className=' mt-10 p-2 bg-violet-400 rounded'> see Preview</button>

               </div>
        </div>

        {/* Right: Previews */}
        <div className="flex flex-col w-2/3 h-full gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Preview</h2>
            <div className="flex gap-2">
              <button className='p-2 bg-violet-400'>Analyse</button>
              <button
                onClick={clearAll}
                className="text-sm px-3 py-1 border rounded hover:bg-gray-50"
                disabled={files.length === 0}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="border rounded p-3 bg-white h-full overflow-auto">
            <p>{analysedResults==null?preview:analysedResults}</p>


            

                 
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

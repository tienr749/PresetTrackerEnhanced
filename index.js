// 필요한 SillyTavern 및 확장 API 함수 import
import { getContext, saveMetadataDebounced, renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

// 확장 이름 정의 (로그 및 식별용)
const EXTENSION_NAME = 'PresetTrackerEnhanced';

// 채팅 메타데이터에 프리셋 정보를 저장할 때 사용할 키
// 형식: { "정규화된send_date_model_정규화된model": "프리셋이름" }
const METADATA_KEY = 'presetsBySwipeKey';

// 불필요 데이터 정리 작업 진행 상태를 추적하는 플래그
let isCleaningInProgress = false;
// 가장 최근에 수집된 프리셋 정보를 임시 저장하는 변수 (키와 값)
let latestPresetInfo = { key: null, value: null };

// 확장 시작 시 초기 메타데이터 상태 로깅 (선택적 디버깅)
// console.log(`[${EXTENSION_NAME}] 확장 시작시 DEBUG Current context.chat_metadata content:`, JSON.stringify(getContext().chat_metadata, null, 2));
// console.log(`[${EXTENSION_NAME}] 확장 시작시.글로벌실리직접참조.메타데이터:`, JSON.stringify(globalThis.SillyTavern.getContext().chatMetadata, null, 2));

// --- Helper 함수: 현재 UI에서 선택된 프리셋 이름 가져오기 ---
function _getCurrentPresetNameFromUI() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - Preset Helper]`;
    let currentPresetName = '(프리셋 정보 없음 - 초기값)'; // 기본값
    try {
        // 현재 화면에 보이는 프리셋 블록 찾기
        const visiblePresetDiv = $('#respective-presets-block > div:not([style*="display: none"])');
        if (visiblePresetDiv.length === 1) {
            // 프리셋 선택 select 요소 찾기
            const presetSelect = visiblePresetDiv.find('select.text_pole');
            if (presetSelect.length === 1) {
                // 선택된 option 요소 찾기
                const selectedOption = presetSelect.find('option:selected');
                if (selectedOption.length === 1) {
                    currentPresetName = selectedOption.text(); // 선택된 프리셋 이름 가져오기
                } else {
                    currentPresetName = '(프리셋 정보 없음 - 옵션 미선택)';
                }
            } else if (presetSelect.length > 1) {
                 // 오류: Select 요소가 여러 개 발견됨
                 currentPresetName = '(프리셋 정보 오류 - Select 여러 개)';
                 console.error(`${DEBUG_PREFIX} Error: Found multiple select.text_pole elements in the visible preset div.`);
            } else {
                // 오류: Select 요소를 찾지 못함
                currentPresetName = '(프리셋 정보 없음 - Select 못찾음)';
            }
        } else if (visiblePresetDiv.length > 1) {
             // 오류: 보이는 프리셋 Div가 여러 개 발견됨
             currentPresetName = '(프리셋 정보 오류 - 보이는 Div 여러 개)';
             console.error(`${DEBUG_PREFIX} Error: Found multiple visible preset divs in #respective-presets-block.`);
        } else {
            // 정보 없음: 보이는 프리셋 Div 없음
            currentPresetName = '(프리셋 정보 없음 - 보이는 Div 없음)';
        }
    } catch (error) {
        // 오류: 프리셋 이름 추출 중 예외 발생
        currentPresetName = '(프리셋 정보 없음 - 추출 오류)';
        console.error(`${DEBUG_PREFIX} Error extracting preset name from UI:`, error);
    }
    return currentPresetName;
}
// --- Helper 함수 끝 ---

// --- Helper 함수: 메시지/스와이프의 send_date와 model 이름을 조합하여 정규화된 키 생성 ---
function _createSwipeKey(sendDate, modelName) {
    // const DEBUG_PREFIX_KEY = `[${EXTENSION_NAME} - KeyGen]`;

    // send_date는 필수 값이므로 없으면 키 생성 불가 (null 반환)
    if (!sendDate) {
        // console.warn(`${DEBUG_PREFIX_KEY} sendDate is missing, cannot generate key.`);
        return null;
    }

    // 1. send_date 정규화: 문자열로 변환 후 공백 제거, 소문자화
    const normalizedSendDate = String(sendDate).replace(/\s+/g, '').toLowerCase();

    // 2. model 이름 정규화: 소문자화, 없으면 'unknown'으로 대체
    const normalizedModelName = (modelName || 'unknown').toLowerCase();

    // 3. 정규화된 값들을 조합하여 최종 키 생성
    const key = `${normalizedSendDate}_model_${normalizedModelName}`;
    // console.log(`${DEBUG_PREFIX_KEY} Generated Key: "${key}" from sendDate: "${sendDate}", model: "${modelName}"`);
    return key;
}
// --- Helper 함수 끝 ---


// 상태 리셋 함수: 채팅 변경 시 호출되어 설정 재로드
function resetState() {
    loadSettings();
}

// 메타데이터 저장 함수: 수집된 최신 프리셋 정보를 메타데이터에 조건부 저장
function saveState() {
    const DEBUG_PREFIX_SAVE = `[${EXTENSION_NAME} - SaveState]`;
    const context = globalThis.SillyTavern.getContext();
    // 컨텍스트 또는 메타데이터 접근 불가 시 오류 처리 및 중단
    if (!context || !context.chatMetadata) {
        console.error(`${DEBUG_PREFIX_SAVE} Critical Error: Context or chatMetadata is not available! Aborting saveState.`);
        return;
    }
    const chatMetadata = context.chatMetadata;
    // 메타데이터 내 프리셋 저장 공간 참조 (없으면 생성 예정)
    let targetMetadata = chatMetadata[METADATA_KEY];

    // 메타데이터 저장소가 없거나 객체가 아니면 빈 객체로 초기화
    if (typeof targetMetadata !== 'object' || targetMetadata === null) {
        // console.log(`${DEBUG_PREFIX_SAVE} [${METADATA_KEY}] 키를 찾을 수 없거나 객체가 아닙니다. 빈 객체 {}로 초기화합니다.`);
        targetMetadata = {};
        chatMetadata[METADATA_KEY] = targetMetadata;
    }

    // 임시 변수에서 새로 추가할 키와 값 가져오기
    const newKey = latestPresetInfo.key;     // 예: "2024-01-01t12:00:00.000z_model_example-model"
    const newValue = latestPresetInfo.value; // 예: "My Awesome Preset"

    // 키 추가 조건: 키가 유효하고(문자열이며 비어있지 않음), 메타데이터에 아직 존재하지 않음
    if (newKey && typeof newKey === 'string' && newKey.trim() !== '') {
        // hasOwnProperty로 해당 키가 객체에 직접 존재하는지 확인 (프로토타입 체인 X)
        if (!targetMetadata.hasOwnProperty(newKey)) {
            // 키가 없을 때만 새로운 키-값 쌍 추가 (덮어쓰기 방지)
            targetMetadata[newKey] = newValue;
            // console.log(`${DEBUG_PREFIX_SAVE} [${METADATA_KEY}] 객체에 새로운 프리셋 정보 추가됨: { "${newKey}": "${newValue}" }`);
        } else {
            // 키가 이미 존재하면 추가하지 않음
            // console.log(`${DEBUG_PREFIX_SAVE} [${METADATA_KEY}] 객체에 키 "${newKey}"가 이미 존재하므로 추가하지 않습니다.`);
        }
    } else {
        // 추가할 키가 유효하지 않은 경우 (예: _createSwipeKey에서 null 반환)
        // console.log(`${DEBUG_PREFIX_SAVE} 추가할 latestPresetInfo.key가 유효하지 않습니다 (값: ${newKey}). 추가 작업을 건너<0xEB><0x9B><0x84>니다.`);
    }

    // 메타데이터 저장 예약 (변경된 경우 디바운스되어 저장됨)
    saveMetadataDebounced();
}

// 설정 로드 함수: 확장 로드 시 또는 채팅 변경 시 호출
function loadSettings() {
    const DEBUG_PREFIX_LOAD = `[${EXTENSION_NAME} - LoadSettings]`;
    const context = getContext();

    // 컨텍스트 접근 불가 시 오류 처리 및 중단
    if (!context) {
        console.error(`${DEBUG_PREFIX_LOAD} Critical Error: Context is not available! Aborting loadSettings.`);
        return;
    }
    // 전역 컨텍스트 및 메타데이터 접근 (없으면 초기화 시도)
    const globalContext = globalThis.SillyTavern.getContext();
    if (!globalContext.chatMetadata) {
         console.warn(`${DEBUG_PREFIX_LOAD} globalContext.chatMetadata is initially undefined/null. Initializing as {}.`);
         globalContext.chatMetadata = {};
    }
    const currentChatMetadata = globalContext.chatMetadata;

    // 임시 프리셋 정보 변수 초기화
    latestPresetInfo = { key: null, value: null };

    // 메타데이터 저장소(METADATA_KEY) 확인 및 초기화
    if (typeof METADATA_KEY === 'undefined') {
        console.error(`${DEBUG_PREFIX_LOAD} Critical Error: METADATA_KEY is not defined! Aborting metadata load.`);
        return;
    }

    // 메타데이터 내 프리셋 저장 공간이 없거나 객체가 아니면 빈 객체로 초기화
    if (!(METADATA_KEY in currentChatMetadata) || typeof currentChatMetadata[METADATA_KEY] !== 'object' || currentChatMetadata[METADATA_KEY] === null) {
        currentChatMetadata[METADATA_KEY] = {};
        console.log(`${DEBUG_PREFIX_LOAD} Initialized metadata storage at key: ${METADATA_KEY}`);
    } else {
        // 기존 메타데이터 발견 시 로그 (선택적)
        // console.log(`${DEBUG_PREFIX_LOAD} Found existing metadata storage at key: ${METADATA_KEY}`);
    }

    // 설정 로드 완료 로그 (현재 메타데이터 상태 포함 - 선택적 디버깅)
    console.log(`${DEBUG_PREFIX_LOAD} Settings load complete for ${EXTENSION_NAME}. Current metadata[${METADATA_KEY}]:`, JSON.stringify(currentChatMetadata[METADATA_KEY], null, 2));
}


/**
 * Preset Tracker Enhanced: 메타데이터에서 불필요 프리셋 데이터 정리
 * 현재 채팅 기록(메시지 및 스와이프)에 존재하지 않는 프리셋 정보를 삭제합니다.
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
async function _cleanupOrphanPresetData() {
    const DEBUG_PREFIX_CLEANUP = `[${EXTENSION_NAME} - Cleanup]`; // 로그용 접두사

    // 1. 중복 실행 방지 확인
    if (isCleaningInProgress) {
        console.warn(`${DEBUG_PREFIX_CLEANUP} Cleanup already in progress.`);
        toastr.warning('이미 정리 작업이 진행 중입니다.');
        return '정리 작업이 이미 진행 중입니다.'; // 슬래시 커맨드 결과 반환
    }

    try {
        // 2. 정리 작업 시작 플래그 설정
        isCleaningInProgress = true;
        // console.log(`${DEBUG_PREFIX_CLEANUP} Starting orphan data cleanup...`);

        // 3. 필수 데이터 가져오기 및 유효성 검사
        const context = globalThis.SillyTavern.getContext();
        if (!context || !context.chat || !context.chatMetadata) {
            console.error(`${DEBUG_PREFIX_CLEANUP} Critical error: Context, chat, or chatMetadata not available.`);
            toastr.error('정리 작업 실패: 필수 데이터를 로드할 수 없습니다.');
            return '정리 작업 실패: 필수 데이터 로드 불가.';
        }

        const presetStorage = context.chatMetadata[METADATA_KEY];

        // 저장된 데이터가 없거나 비어있는 경우
        if (!presetStorage || typeof presetStorage !== 'object' || Object.keys(presetStorage).length === 0) {
            // console.log(`${DEBUG_PREFIX_CLEANUP} No preset data found in metadata or metadata is empty. Nothing to clean.`);
            toastr.info('정리할 프리셋 데이터가 없습니다.');
            return '정리할 프리셋 데이터가 없습니다.';
        }

        // 4. 현재 채팅에 존재하는 유효한 키 목록 생성 (Set 사용으로 중복 자동 제거 및 빠른 조회)
        const validKeys = new Set();
        // console.log(`${DEBUG_PREFIX_CLEANUP} Scanning chat messages to identify valid keys...`);

        for (const message of context.chat) {
            // AI 메시지가 아니면 건너뜀
            if (message.is_user || message.is_system) {
                continue;
            }

            // 기본 메시지 정보로 키 생성 시도
            let baseKey = _createSwipeKey(message.send_date, message.extra?.model);
            if (baseKey) {
                validKeys.add(baseKey);
            }

            // 스와이프 정보가 있으면 각 스와이프로 키 생성 시도
            if (Array.isArray(message.swipe_info)) {
                for (const swipe of message.swipe_info) {
                    if (swipe) { // 스와이프 데이터 유효성 확인
                        let swipeKey = _createSwipeKey(swipe.send_date, swipe.extra?.model);
                        if (swipeKey) {
                            validKeys.add(swipeKey);
                        }
                    }
                }
            }
        }
        // console.log(`${DEBUG_PREFIX_CLEANUP} Identified ${validKeys.size} valid keys in the current chat.`);

        // 5. 메타데이터 순회하며 유효하지 않은(불필요) 키 삭제
        let deletedCount = 0;
        const metadataKeys = Object.keys(presetStorage);
        // console.log(`${DEBUG_PREFIX_CLEANUP} Checking ${metadataKeys.length} stored keys against valid keys...`);

        for (const metadataKey of metadataKeys) {
            // 메타데이터 키가 유효 키 Set에 없으면 불필요 데이터
            if (!validKeys.has(metadataKey)) {
                // console.log(`${DEBUG_PREFIX_CLEANUP} Deleting orphan key: ${metadataKey}`);
                delete presetStorage[metadataKey]; // 객체에서 해당 키 삭제
                deletedCount++;
            }
        }

        // 6. 변경 사항 저장 및 사용자 피드백
        let feedbackMessage;
        if (deletedCount > 0) {
            // 삭제된 항목이 있을 때만 저장하고 성공 메시지 표시
            // console.log(`${DEBUG_PREFIX_CLEANUP} Deleted ${deletedCount} orphan entries. Saving metadata...`);
            saveMetadataDebounced();
            feedbackMessage = `${deletedCount}개의 사용하지 않는 프리셋 정보가 정리되었습니다.`;
            toastr.success(feedbackMessage);
        } else {
            // 삭제된 항목이 없을 때 정보 메시지 표시
            // console.log(`${DEBUG_PREFIX_CLEANUP} No orphan entries found to delete.`);
            feedbackMessage = '사용하지 않는 프리셋 정보가 없어 정리할 내용이 없습니다.';
            toastr.info(feedbackMessage);
        }
        return feedbackMessage; // 슬래시 커맨드 결과 반환

    } catch (error) {
        // 7. 오류 처리
        console.error(`${DEBUG_PREFIX_CLEANUP} Error during cleanup process:`, error);
        toastr.error('데이터 정리 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.');
        return '데이터 정리 중 오류 발생.'; // 슬래시 커맨드 결과 반환
    } finally {
        // 8. 작업 완료 후 플래그 리셋 (성공/실패 무관하게 항상 실행)
        isCleaningInProgress = false;
        // console.log(`${DEBUG_PREFIX_CLEANUP} Cleanup process finished.`);
    }
}


// jQuery Ready 함수: 문서 로딩 완료 후 실행
jQuery(async () => {
    console.log(`[${EXTENSION_NAME}] Extension Loading...`);

    // 초기 설정 로드
    loadSettings();

    // --- 설정 페이지 HTML 로드 및 추가 ---
    try {
        // 'templates/settings.html' 파일 비동기 로드
        const settingsHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'settings');
        // SillyTavern의 표준 확장 설정 영역 컨테이너 찾기
        const container = $('#extensions_settings');
        // 컨테이너가 존재하면 로드한 HTML 추가
        if (container.length > 0) {
            container.append(settingsHtml);
            console.log(`[${EXTENSION_NAME}] Settings HTML loaded into #extensions_settings.`);
        } else {
            // 컨테이너 못 찾으면 경고 로그
            console.warn(`[${EXTENSION_NAME}] Could not find container #extensions_settings to load settings HTML.`);
        }
    } catch (error) {
        // HTML 로드/추가 중 오류 발생 시 에러 로그
        console.error(`[${EXTENSION_NAME}] Error loading or appending settings HTML:`, error);
    }
    // --- 설정 페이지 로드 끝 ---

    // --- SillyTavern 이벤트 리스너 등록 ---

    // 채팅 변경 시: 상태 리셋 (설정 재로드)
    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log(`[${EXTENSION_NAME}] Chat changed, resetting state.`);
        resetState();
    });

    // 새 메시지 수신 시: 프리셋 정보 수집 및 저장 시도
    eventSource.on(event_types.MESSAGE_RECEIVED, async (msgId) => {
        const DEBUG_PREFIX_MSG = `[${EXTENSION_NAME} - Msg Rcvd]`;
        // console.log(`\n${DEBUG_PREFIX_MSG} === Handler Start === MsgId: ${msgId}`);

        let presetCollected = false;
        let generatedKey = null;
        try {
            const context = getContext();
            // 컨텍스트 또는 채팅 데이터 유효성 검사
            if (!context || !context.chat || context.chat.length === 0) {
                console.warn(`${DEBUG_PREFIX_MSG} Preset Info: Invalid context or empty chat.`);
                return;
            }

            // 마지막 AI 메시지 식별 (마지막이 사용자면 그 이전 메시지 확인)
            let messageIndex = context.chat.length - 1;
            let message = context.chat[messageIndex];
            if (message && message.is_user && messageIndex > 0) {
                 messageIndex--;
                 message = context.chat[messageIndex];
            }

            // 식별된 메시지가 AI 메시지이고 시스템 메시지가 아닐 경우 처리
            if (message && !message.is_user && !message.is_system) {
                // 현재 활성화된 스와이프 정보 가져오기 (없으면 메시지 자체 사용)
                const currentIndex = message.swipe_id ?? 0;
                let currentSwipeData = message; // 기본값: 메시지 자체
                if (Array.isArray(message.swipe_info) && currentIndex >= 0 && currentIndex < message.swipe_info.length && message.swipe_info[currentIndex]) {
                    currentSwipeData = message.swipe_info[currentIndex]; // 유효한 스와이프 데이터 사용
                } else if (Array.isArray(message.swipe_info)) {
                    // 스와이프 배열은 있지만 인덱스가 잘못된 경우 경고
                    console.warn(`${DEBUG_PREFIX_MSG} Using message object as fallback for swipe data (Index: ${currentIndex} out of bounds or invalid).`);
                }

                // 키 생성을 위한 정보 추출 (Optional Chaining 사용)
                const sendDate = currentSwipeData?.send_date;
                const modelName = currentSwipeData?.extra?.model;

                // console.log(`${DEBUG_PREFIX_MSG} Extracted for key gen - sendDate: "${sendDate}", modelName: "${modelName}"`);

                // 정규화된 키 생성 시도
                generatedKey = _createSwipeKey(sendDate, modelName);
                // console.log(`${DEBUG_PREFIX_MSG} Generated Key: "${generatedKey}"`);

                // 유효한 키가 생성되었을 경우
                if (generatedKey) {
                    // 현재 UI에서 프리셋 이름 가져오기
                    const currentPresetName = _getCurrentPresetNameFromUI();
                    // 가져온 프리셋 이름이 실제 이름인지 (폴백 문자열이 아닌지) 확인
                    const isValidPresetName = currentPresetName &&
                                             !currentPresetName.startsWith('(프리셋 정보 없음') &&
                                             !currentPresetName.startsWith('(프리셋 정보 오류');

                    if (isValidPresetName) {
                        // 유효한 프리셋 이름일 때만 임시 변수 업데이트 및 수집 플래그 설정
                        latestPresetInfo = { key: generatedKey, value: currentPresetName };
                        presetCollected = true; // 수집 성공 플래그
                        // console.log(`${DEBUG_PREFIX_MSG} Preset Info Collected: Key="${generatedKey}", Preset="${currentPresetName}"`);
                    } else {
                        // 폴백 문자열일 경우, 수집/저장하지 않음
                        // console.log(`${DEBUG_PREFIX_MSG} Preset name is a fallback value ("${currentPresetName}"). Skipping collection for key "${generatedKey}".`);
                    }
                } else {
                     // 키 생성 실패 시 로그 (주로 send_date 누락)
                     // console.log(`${DEBUG_PREFIX_MSG} Key generation failed (likely missing sendDate). Skipping preset collection.`);
                }
            } else {
                 // 처리 대상 AI 메시지가 아닐 경우 로그
                 // console.log(`${DEBUG_PREFIX_MSG} Last message is not a processable AI message (is_user: ${message?.is_user}, is_system: ${message?.is_system}).`);
            }
        } catch (error) {
            // 프리셋 정보 수집 중 예외 발생 시 에러 로그
            console.error(`${DEBUG_PREFIX_MSG} Error during preset info collection:`, error);
        }

        // 프리셋 정보가 성공적으로 수집되었을 경우 저장 함수 호출
        if (presetCollected) {
            // console.log(`${DEBUG_PREFIX_MSG} Calling saveState() to save collected preset info.`);
            saveState(); // 메타데이터에 조건부 저장 시도
        } else {
            // 수집 실패 시 저장 건너뜀 로그
            // console.log(`${DEBUG_PREFIX_MSG} No preset info collected, skipping saveState().`);
        }

        // console.log(`${DEBUG_PREFIX_MSG} === Handler End === MsgId: ${msgId}\n`);
    });

    // --- UI 요소 이벤트 리스너 등록 ---

    // 캐릭터 이름 클릭 시: 모델/프리셋 정보 표시 (기존 리스너 제거 후 재등록)
    $(document).off(`click.${EXTENSION_NAME}`, '#chat .mes .name_text'); // 네임스페이스 사용 권장
    $(document).on(`click.${EXTENSION_NAME}`, '#chat .mes .name_text', async function (e) {
        e.preventDefault(); // 기본 동작 방지
        e.stopPropagation(); // 이벤트 버블링 방지

        const nameTextElement = $(this);
        const messageElement = nameTextElement.closest('.mes'); // 클릭된 이름이 속한 메시지 요소 찾기
        const messageId = messageElement.attr('mesid');         // 메시지 ID 속성 가져오기
        const DEBUG_PREFIX_CLICK = `[${EXTENSION_NAME} Click]`;

        // 메시지 ID 없으면 경고 후 종료
        if (messageId === undefined) {
            console.warn(`${DEBUG_PREFIX_CLICK} Could not find message ID for clicked name text.`);
            return;
        }

        try {
            const context = globalThis.SillyTavern.getContext();
            const chatMetadata = context?.chatMetadata ?? null;

            // 컨텍스트, 채팅 기록, 메타데이터 유효성 검사
            if (!context || !context.chat || !chatMetadata) {
                console.warn(`${DEBUG_PREFIX_CLICK} Global Context, chat, or chatMetadata not available.`);
                return;
            }

            // 메시지 ID를 정수로 변환하고 유효 범위 확인
            const msgIndex = parseInt(messageId);
            if (isNaN(msgIndex) || msgIndex < 0 || msgIndex >= context.chat.length) {
                console.warn(`${DEBUG_PREFIX_CLICK} Invalid message index: ${messageId}`);
                return;
            }

            // 해당 인덱스의 메시지 객체 가져오기
            const message = context.chat[msgIndex];
            // 메시지 객체가 없으면 오류 처리 후 종료
            if (!message) {
                console.error(`${DEBUG_PREFIX_CLICK} Message object is MISSING for ID: ${messageId}.`);
                return;
            }

            // 사용자 메시지 또는 시스템 메시지 클릭 시 조용히 종료 (정보 표시 X)
            if (message.is_user || message.is_system) {
                 // console.log(`${DEBUG_PREFIX_CLICK} Clicked on user/system message (${messageId}). Aborting display.`);
                 return;
            }

            // --- 이하 로직은 AI 메시지에 대해서만 실행됨 ---

            // 현재 활성화된 스와이프 정보 가져오기 (없으면 메시지 자체 사용)
            const currentSwipeIndex = message.swipe_id ?? 0;
            let activeDataSource = message; // 기본 데이터 소스
            let toastSwipeText = ""; // Toastr 제목에 추가할 스와이프 정보

            // 유효한 스와이프 정보가 있을 경우 데이터 소스 및 텍스트 업데이트
            if (Array.isArray(message.swipe_info) &&
                currentSwipeIndex >= 0 &&
                currentSwipeIndex < message.swipe_info.length &&
                message.swipe_info[currentSwipeIndex])
            {
                activeDataSource = message.swipe_info[currentSwipeIndex];
                toastSwipeText = ` (스와이프 ${currentSwipeIndex + 1})`; // 예: " (스와이프 3)"
            } else if (Array.isArray(message.swipe_info)) {
                // 스와이프 배열은 있지만 인덱스가 잘못된 경우 로그
                 // console.log(`${DEBUG_PREFIX_CLICK} Using message itself (invalid swipe index ${currentSwipeIndex}) for message ID: ${messageId}`);
            }

            // 1. 모델 이름 가져오기 (activeDataSource에서)
            const modelName = activeDataSource?.extra?.model || '(모델 정보 없음)';

            // 2. 프리셋 이름 가져오기
            const sendDate = activeDataSource?.send_date;
            const modelNameToUse = activeDataSource?.extra?.model; // 조회용 키 생성에 사용할 모델 이름

            let presetName = '(프리셋 정보 없음)';
            let lookupKey = null;

            // console.log(`${DEBUG_PREFIX_CLICK} Extracted for lookup - sendDate: "${sendDate}", modelName: "${modelNameToUse}"`);

            // 조회용 키 생성 시도
            lookupKey = _createSwipeKey(sendDate, modelNameToUse);
            // console.log(`${DEBUG_PREFIX_CLICK} Generated Lookup Key: "${lookupKey}"`);

            // 유효한 키가 생성되었을 경우 메타데이터에서 프리셋 이름 조회
            if (lookupKey) {
                const presetStorage = chatMetadata?.[METADATA_KEY]; // 메타데이터 저장소 접근

                if (presetStorage && typeof presetStorage === 'object') {
                    // 저장소에서 키로 값(프리셋 이름) 조회, 없으면 '기록 없음' 메시지
                    presetName = presetStorage[lookupKey] || '(프리셋 정보 없음)';
                } else {
                    // 메타데이터 저장소 자체가 없거나 객체가 아닐 경우
                    presetName = '(프리셋 정보 없음 - 메타데이터 저장소 누락)';
                     console.warn(`${DEBUG_PREFIX_CLICK} Preset storage (${METADATA_KEY}) not found or not an object in chatMetadata.`);
                }
            } else {
                // 키 생성 실패 시
                presetName = '(프리셋 정보 없음 - 유효 키 생성 불가)';
            }

            // 조회 결과 로그 (선택적 디버깅)
            // console.log(`${DEBUG_PREFIX_CLICK} Result -> Message: ${messageId}, Swipe Index: ${currentSwipeIndex}, Key: ${lookupKey}, Model: ${modelName}, Preset: ${presetName}`);

            // 3. Toastr 알림으로 정보 표시
            const toastTitle = `메시지 #${messageId}${toastSwipeText} 정보`;
            const toastContentHtml = `
                <strong>모델:</strong><br>${modelName}<br><br>
                <strong>프리셋:</strong><br>${presetName}
            `;
            // Toastr 옵션 설정
            const toastOptions = {
                "closeButton": true,
                "progressBar": true,
                "positionClass": "toast-top-center", // 화면 상단 중앙
                "timeOut": "7000", // 7초 동안 표시
                "extendedTimeOut": "2000", // 마우스 오버 시 추가 표시 시간
                "escapeHtml": false // HTML 태그 사용 허용
            };

            // Toastr 라이브러리가 로드되었는지 확인 후 알림 표시
            if (typeof toastr === 'object' && typeof toastr.info === 'function') {
                toastr.info(toastContentHtml, toastTitle, toastOptions);
            } else {
                // Toastr 없으면 기본 alert 창 사용 (Fallback)
                console.error(`${DEBUG_PREFIX_CLICK} Toastr object is not available.`);
                alert(`${toastTitle}\n\n모델:\n${modelName}\n\n프리셋:\n${presetName}`);
            }

        } catch (error) {
            // 이름 클릭 처리 중 예외 발생 시 에러 로그 및 알림
            console.error(`${DEBUG_PREFIX_CLICK} Unexpected error displaying info for message ID ${messageId} (name click):`, error);
            toastr.error('정보를 표시하는 중 예상치 못한 오류가 발생했습니다.');
        }
    });

    // --- 슬래시 커맨드 등록 ---
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pteCleanOrphanData', // 커맨드 이름 (예: /pteCleanOrphanData)
        callback: _cleanupOrphanPresetData, // 실행할 함수 연결
        helpString: 'Preset Tracker Enhanced: 사용하지 않는 프리셋 기록(불필요 데이터)을 정리합니다.', // 도움말 설명
        returns: '정리된 항목 수를 포함한 결과 메시지를 반환합니다.' // 반환값 설명 (선택적)
    }));

    console.log(`[${EXTENSION_NAME}] Event Listeners & Slash Command Registered.`);
    console.log(`[${EXTENSION_NAME}] Extension Loaded Successfully.`);
});

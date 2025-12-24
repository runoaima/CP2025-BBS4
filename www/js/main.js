let postsRef;
let postsListener = null;
// 現在の編集対象のID
let currentEditId = null;
// ログイン中のユーザ
let currentUser = null;

// メッセージ表示処理
function showMessage(message, type = 'success') {
    const messageArea = $('#messageArea');
    messageArea.html(`
        <div class="message ${type}">
            ${message}
        </div>
    `);

    // 3秒後にメッセージを消す
    setTimeout(() => {
        messageArea.empty();
    }, 3000);
}

// 認証エラーメッセージの日本語化
function getAuthErrorMessage(error) {
    // エラーコードがある場合
    if (error.code) {
        return `認証エラーが発生しました（${error.code}）`;
    } else if (error.message) {
        return `エラーが発生しました：${error.message}`;
    } else {
        return 'エラーが発生しました';
    }
}

// 文字数カウントの更新
function updateCharacterCount(inputId, counterId, maxLength) {
    const input = $(`#${inputId}`);
    const counter = $(`#${counterId}`);

    input.on('input', () => {
        const length = input.val().length;
        counter.text(`${length}/${maxLength}`);

        if (length > maxLength) {
            counter.addClass('error');
        } else {
            counter.removeClass('error');
        }
    });
}

// 投稿内容のバリデーション
function validateContent(content) {
    if (!content || !content.trim()) {
        showMessage('投稿内容を入力してください', 'error');
        return false;
    }
    if (content.length > 1000) {
        showMessage('投稿内容は1000文字以内で入力してください', 'error');
        return false;
    }
    return true;
}

// 認証フォームのバリデーション
function validateAuthInput(email, password, isRegister = false) {
    if (!email || !email.trim()) {
        showMessage('メールアドレスを入力してください', 'error');
        return false;
    }
    if (!password || !password.trim()) {
        showMessage('パスワードを入力してください', 'error');
        return false;
    }
    if (isRegister && password.length < 6) {
        showMessage('パスワードは6文字以上にしてください', 'error');
        return false;
    }
    return true;
}

// 投稿処理
function createPost(author, content) {
    if (!currentUser) {
        showMessage('投稿するにはログインが必要です', 'error');
        return;
    }

    if (!validateContent(content)) return;

    const button = $('#postButton');
    button.prop('disabled', true);

    // author はログインしているユーザのメールアドレスに変更、userId を追加
    const postData = {
        author: currentUser.email,
        content: content,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        userId: currentUser.uid
    };

    postsRef.push(postData)
        .then(() => {
            showMessage('投稿が完了しました！');
            $('#contentInput').val('');
            updateCharacterCount('contentInput', 'contentCount', 1000);
        })
        .catch((error) => {
            showMessage('投稿に失敗しました：' + error.message, 'error');
        })
        .finally(() => {
            button.prop('disabled', false);
        });
}

// HTMLエスケープ処理
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// タイムスタンプのフォーマット
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 投稿の編集権限チェック
function canEditPost(post) {
    return currentUser && post.userId === currentUser.uid;
}

// 投稿のHTML要素を生成
// 　バグ入りなので要修正（編集・削除機能表示判定が誤っている）
function createPostElement(post) {
    // 編集権限を確認
    const canEdit = canEditPost(post);
    // 編集権限があれば、編集・削除機能を表示
    const actions = canEdit ? `
        <div class="post-actions">
            <button class="btn-edit" onclick="startEdit('${post.id}')">
                編集
            </button>
            <button class="btn-delete" onclick="deletePost('${post.id}')">
                削除
            </button>
        </div>
    ` : '';

    return `
        <div class="post" id="post-${post.id}">
            <div class="post-header">
                <span class="post-author">${escapeHtml(post.author)}</span>
                <!-- 編集権限があれば、編集・削除機能を表示 -->
                ${actions}
            </div>
            <div class="post-content">${escapeHtml(post.content)}</div>
            <div class="edit-form">
                <textarea class="form-control" id="edit-${post.id}"></textarea>
                <div class="button-group">
                    <button class="btn-primary" onclick="updatePost('${post.id}')">
                        更新
                    </button>
                    <button class="btn-cancel" onclick="cancelEdit('${post.id}')">
                        キャンセル
                    </button>
                </div>
            </div>
            <div class="post-footer">
                <span class="post-time">
                    ${formatTimestamp(post.timestamp)}
                </span>
                ${post.updatedAt ? `
                    <span class="post-updated">
                        (編集済み: ${formatTimestamp(post.updatedAt)})
                    </span>
                ` : ''}
            </div>
        </div>
    `;
}

// 投稿の表示処理
function renderPosts(posts) {
    const postsDiv = $('#postsList');
    postsDiv.empty();

    if (posts.length === 0) {
        postsDiv.html('<p class="no-posts">投稿はありません</p>');
        return;
    }

    posts.forEach((post) => {
        postsDiv.append(createPostElement(post));
    });
}

// 投稿の読み込み
function loadPosts() {
    const sortOrder = $('#sortOrder').val();
    $('#loadingSpinner').show();

    // 既存のリスナーを解除
    if (postsListener) {
        postsRef.off('value', postsListener);
        postsListener = null;
    }

    // リスナーを設定
    postsListener = postsRef.on('value', (snapshot) => {
        const posts = [];
        snapshot.forEach((childSnapshot) => {
            posts.push({
                id: childSnapshot.key,
                ...childSnapshot.val()
            });
        });

        // 並び順の適用
        if (sortOrder === 'newest') {
            posts.sort((a, b) => b.timestamp - a.timestamp);
        } else {
            posts.sort((a, b) => a.timestamp - b.timestamp);
        }

        renderPosts(posts);
        $('#loadingSpinner').hide();
    }, (error) => {
        console.error('Data fetch error:', error);
        showMessage('データの読み込みに失敗しました', 'error');
        $('#loadingSpinner').hide();
    });
}

// モーダル関連の関数
function showModal(modalId) {
    $(`#${modalId}`).fadeIn(200);
    $('body').addClass('modal-open');
}

function closeModal(modalId) {
    $(`#${modalId}`).fadeOut(200);
    $('body').removeClass('modal-open');
}

// 更新処理のハンドラ
function handleUpdate() {
    if (!currentEditId) return;

    const content = $('#editContent').val();
    if (!validateContent(content)) return;

    const updates = {
        content: content,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    postsRef.child(currentEditId).update(updates)
        .then(() => {
            showMessage('投稿を更新しました');
            closeModal('editModal');
            animateUpdate(currentEditId);
            currentEditId = null;
        })
        .catch((error) => {
            showMessage('更新に失敗しました：' + error.message, 'error');
        });
}

// 削除処理のハンドラ
function handleDelete() {
    if (!currentEditId) return;

    const postElement = $(`#post-${currentEditId}`);
    postElement.addClass('deleting');

    postsRef.child(currentEditId).remove()
        .then(() => {
            showMessage('投稿を削除しました');
            closeModal('deleteModal');
            currentEditId = null;
        })
        .catch((error) => {
            showMessage('削除に失敗しました：' + error.message, 'error');
            postElement.removeClass('deleting');
        });
}

// モーダルの外側をクリックした時の処理
$(document).on('click', '.modal-overlay', function () {
    const modalId = $(this).parent().attr('id');
    closeModal(modalId);
});


// ESCキーでモーダルを閉じる
$(document).on('keydown', (e) => {
    if (e.key === 'Escape') {
        $('.modal:visible').each(() => {
            closeModal(this.id);
        });
    }
});

// 編集の開始
function startEdit(postId) {
    currentEditId = postId;
    const post = $(`#post-${postId}`);
    const content = post.find('.post-content').text();

    $('#editContent').val(content);
    updateCharacterCount('editContent', 'editContentCount', 1000);
    showModal('editModal');
}

// 編集のキャンセル
function cancelEdit(postId) {
    const postElement = $(`#post-${postId}`);
    postElement.removeClass('editing');
    postElement.find('textarea').val('');
}

// 投稿の更新
function updatePost(postId) {
    const contentVal = $(`#edit-${postId}`).val();
    if (!validateContent(contentVal)) return;

    // content の内容を変更し、updatedAt フィールドを付加して、更新後の投稿内容を生成
    const updates = {
        content: contentVal,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    postsRef.child(postId).update(updates)
        .then(() => {
            showMessage('投稿を更新しました');
            $(`#post-${postId}`).removeClass('editing');
            animateUpdate(postId);
        })
        .catch((error) => {
            showMessage('更新に失敗しました：' + error.message, 'error');
        });
}

// 投稿の削除
function deletePost(postId) {
    currentEditId = postId;
    showModal('deleteModal');
}

// 更新時のアニメーション
function animateUpdate(postId) {
    const post = $(`#post-${postId}`);
    post.addClass('updated');
    setTimeout(() => {
        post.removeClass('updated');
    }, 1000);
}

// ログイン処理
function login(email, password) {
    if (!validateAuthInput(email, password)) return;

    const button = $('#loginButton');
    button.prop('disabled', true);

    firebase.auth().signInWithEmailAndPassword(email, password)
        .then(() => {
            showMessage('ログインしました');
            clearAuthForm();
        })
        .catch((error) => {
            showMessage(getAuthErrorMessage(error), 'error');
        })
        .finally(() => {
            button.prop('disabled', false);
        });
}

// 新規登録処理
function register(email, password) {
    if (!validateAuthInput(email, password, true)) return;

    const button = $('#registerButton');
    button.prop('disabled', true);

    firebase.auth().createUserWithEmailAndPassword(email, password)
        .then(() => {
            showMessage('アカウントを作成しました');
            clearAuthForm();
        })
        .catch((error) => {
            showMessage(getAuthErrorMessage(error), 'error');
        })
        .finally(() => {
            button.prop('disabled', false);
        });
}

// ログアウト処理
function logout() {
    firebase.auth().signOut()
        .then(() => {
            showMessage('ログアウトしました');
        })
        .catch((error) => {
            showMessage('ログアウトに失敗しました', 'error');
        });
}

// 認証フォームのクリア
function clearAuthForm() {
    $('#loginEmail').val('');
    $('#loginPassword').val('');
}

// UI更新
// 　バグ入りなので要修正（emailアドレスを表示するべきところを uid を表示してしまっている）
function updateUI(user) {
    if (user) {
        $('.logged-in').show();
        $('.logged-out').hide();
        $('#userEmail').text(user.email);
    } else {
        $('.logged-in').hide();
        $('.logged-out').show();
        $('#userEmail').text('');
    }
}

function createNotification(targetUserId, type, postId) {
    if (!currentUser || !targetUserId || targetUserId === currentUser.uid) return;

    firebase.database().ref('notifications').push({
        targetUserId: targetUserId,
        type: type,
        postId: postId,
        from: currentUser.email,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });
}

function extractHashtags(text) {
    const matches = text.match(/#[^\s#]+/g);
    return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

function filterByHashtag(tag) {
    postsRef.once('value', snapshot => {
        const posts = [];
        snapshot.forEach(child => {
            const post = child.val();
            if (post.hashtags && post.hashtags.includes(tag)) {
                posts.push({ id: child.key, ...post });
            }
        });
        renderPosts(posts);
    });
}

function uploadImage(file) {
    const ref = firebase.storage().ref(`images/${Date.now()}_${file.name}`);
    return ref.put(file).then(snapshot => snapshot.ref.getDownloadURL());
}

function toggleLike(postId) {
    if (!currentUser) {
        showMessage('ログインしてください', 'error');
        return;
    }

    const likeRef = postsRef.child(postId).child('likes').child(currentUser.uid);

    postsRef.child(postId).child('userId').once('value').then(ownerSnap => {
        const ownerId = ownerSnap.val();

        likeRef.once('value').then(snapshot => {
            if (snapshot.exists()) {
                likeRef.remove();
            } else {
                likeRef.set(true).then(() => {
                    createNotification(ownerId, 'like', postId);
                });
            }
        });
    });
}

function addComment(postId) {
    if (!currentUser) {
        showMessage('ログインしてください', 'error');
        return;
    }

    const input = $(`#comment-input-${postId}`);
    const text = input.val();

    if (!text || !text.trim()) {
        showMessage('コメントを入力してください', 'error');
        return;
    }

    postsRef.child(postId).child('userId').once('value').then(ownerSnap => {
        const ownerId = ownerSnap.val();

        postsRef.child(postId).child('comments').push({
            user: currentUser.email,
            text: text,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        }).then(() => {
            input.val('');
            createNotification(ownerId, 'comment', postId);
        });
    });
}

const originalCreatePost = createPost;
createPost = async function (author, content) {
    if (!currentUser) {
        showMessage('投稿するにはログインが必要です', 'error');
        return;
    }

    if (!validateContent(content)) return;

    const button = $('#postButton');
    button.prop('disabled', true);

    try {
        let imageUrl = null;
        const file = $('#imageInput')[0] ? $('#imageInput')[0].files[0] : null;

        if (file) {
            imageUrl = await uploadImage(file);
        }

        const postData = {
            author: currentUser.email,
            content: content,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            userId: currentUser.uid,
            imageUrl: imageUrl,
            hashtags: extractHashtags(content)
        };

        postsRef.push(postData)
            .then(() => {
                showMessage('投稿が完了しました！');
                $('#contentInput').val('');
                if ($('#imageInput')[0]) $('#imageInput').val('');
                updateCharacterCount('contentInput', 'contentCount', 1000);
            })
            .catch((error) => {
                showMessage('投稿に失敗しました：' + error.message, 'error');
            })
            .finally(() => {
                button.prop('disabled', false);
            });

    } catch (error) {
        showMessage('投稿に失敗しました：' + error.message, 'error');
        button.prop('disabled', false);
    }
};

const originalCreatePostElement = createPostElement;
createPostElement = function (post) {
    const likeCount = post.likes ? Object.keys(post.likes).length : 0;
    const liked = post.likes && currentUser && post.likes[currentUser.uid];

    const hashtags = post.hashtags
        ? post.hashtags.map(tag =>
            `<span class="hashtag" onclick="filterByHashtag('${tag}')">${escapeHtml(tag)}</span>`
        ).join(' ')
        : '';

    const comments = post.comments
        ? Object.values(post.comments).map(c =>
            `<div class="comment"><b>${escapeHtml(c.user)}</b>: ${escapeHtml(c.text)}</div>`
        ).join('')
        : '';

    return `
        <div class="post" id="post-${post.id}">
            <div class="post-header">
                <span class="post-author">${escapeHtml(post.author)}</span>
                ${canEditPost(post) ? `
                    <div class="post-actions">
                        <button class="btn-edit" onclick="startEdit('${post.id}')">編集</button>
                        <button class="btn-delete" onclick="deletePost('${post.id}')">削除</button>
                    </div>
                ` : ''}
            </div>

            <div class="post-content">${escapeHtml(post.content)}</div>

            ${post.imageUrl ? `
                <div class="post-image-wrap">
                    <img src="${post.imageUrl}" class="post-image">
                </div>
            ` : ''}

            ${hashtags ? `<div class="hashtags">${hashtags}</div>` : ''}

            <div class="post-actions-like">
                <button onclick="toggleLike('${post.id}')" class="like-btn ${liked ? 'liked' : ''}">
                    ❤️ ${likeCount}
                </button>
            </div>

            <div class="comments">
                <div class="comment-list">${comments}</div>
                <div class="comment-form">
                    <input id="comment-input-${post.id}" class="form-control" placeholder="コメントを書く">
                    <button onclick="addComment('${post.id}')" class="btn-secondary">送信</button>
                </div>
            </div>

            <div class="post-footer">
                <span class="post-time">${formatTimestamp(post.timestamp)}</span>
                ${post.updatedAt ? `
                    <span class="post-updated">
                        (編集済み: ${formatTimestamp(post.updatedAt)})
                    </span>
                ` : ''}
            </div>
        </div>
    `;
};


$(function () {
    try {
        firebase.initializeApp(firebaseConfig);
        console.log("Firebase initialized successfully");
        postsRef = firebase.database().ref('posts');
    } catch (error) {
        console.error("Firebase initialization error:", error);
        showMessage('Firebaseの初期化に失敗しました', 'error');
    }

    firebase.auth().onAuthStateChanged((user) => {
        currentUser = user;
        updateUI(user);
        loadPosts();
    });

    updateCharacterCount('contentInput', 'contentCount', 1000);

    $('#postButton').on('click', () => {
        const authorVal = $('#authorInput').val();
        const contentVal = $('#contentInput').val();
        createPost(authorVal, contentVal);
    });

    $('#loginButton').on('click', () => {
        const email = $('#loginEmail').val();
        const password = $('#loginPassword').val();
        login(email, password);
    });

    $('#registerButton').on('click', () => {
        const email = $('#loginEmail').val();
        const password = $('#loginPassword').val();
        register(email, password);
    });

    $('#logoutButton').on('click', logout);

    $('#sortOrder').on('change', loadPosts);

    loadPosts();
});

window.addEventListener('unload', () => {
    if (postsListener) {
        postsRef.off('value', postsListener);
        postsListener = null;
    }
});

// ユーザーアイコンボタン
$(function () {

    $('#userIcon').on('click', function () {

        if (!currentUser) {
            const auth = $('.auth-container');
            $('#authModalBody').append(auth);
            showModal('authModal');
            return;
        }

        showModal('profileModal');
    });

});



$('#profileLogoutBtn').on('click', logout);

firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        $('#profileEmail').text(user.email);
    }
});



// 新規投稿ボタン
$(function () {

    $('#floatingPostBtn').on('click', function () {
        if (!currentUser) {
            showMessage('ログインしてください', 'error');
            return;
        }

        $('#modalContentInput').val('');
        $('#imageInput').val('');
        updateCharacterCount('modalContentInput', 'modalContentCount', 1000);
        showModal('newPostModal');
    });

    $('#modalPostButton').on('click', function () {
        const content = $('#modalContentInput').val();
        createPost(null, content);
        closeModal('newPostModal');
    });

});

function closeModal(modalId) {
    const modal = $(`#${modalId}`);

    modal.stop(true, true).fadeOut(200, function () {
        modal.css({
            display: 'none',
            pointerEvents: 'none'
        });
    });

    $('body').removeClass('modal-open');

    // authModal の場合のみ戻す
    if (modalId === 'authModal') {
        $('.container').prepend($('.auth-container'));
    }
}

function showModal(modalId) {
    const modal = $(`#${modalId}`);

    // 他の modal を全て完全に閉じる
    $('.modal').css({
        display: 'none',
        pointerEvents: 'none'
    });

    modal.css({
        display: 'block',
        pointerEvents: 'auto'
    }).fadeIn(200);

    $('body').addClass('modal-open');
}

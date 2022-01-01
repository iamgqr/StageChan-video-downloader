// ==UserScript==
// @name         StageChan video downloader
// @namespace    https://github.com/iamgqr/
// @version      0.3.2
// @description  various video downloading
// @author       StageChan
// @match        https://www.nicovideo.jp/watch/*
// @match        https://live.nicovideo.jp/watch/*
// @match        https://twitcasting.tv/*/movie/*
// @grant        none
// @require      https://unpkg.com/ajax-hook@2.0.3/dist/ajaxhook.min.js
// @require      https://static.hdslb.com/js/jquery.min.js
// ==/UserScript==

let v = {
    captured: false,
    downloading: false,
    duration: Infinity,
    cnt: {
        done: 0,
        error: 0,
        req: 0
    },
    valid_response_list: {},
};

let c = {
    index_map: null,
    req_sleeptime: 0,
    req_timeout: -1,
}

window.addEventListener('beforeunload', (event) => {
    if (v.downloading) {
        event.returnValue = true;
    }
});

const triggerDownload = (url, filename) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
};

const do_download = (video, filename) => {
    let video_blob = new Blob(video, { type: 'video/MP2T' });
    let video_blob_url = URL.createObjectURL(video_blob);
    triggerDownload(video_blob_url, filename);
    if ($("#video_download_close_tab").prop('checked')) {
        v.downloading = false;
        setTimeout(window.close(), 5000);
    }
};

const downloading_message = (message) => {
    $("#video_download").text(`${message} ${v.cnt.done * 5}/${v.duration}/${v.cnt.error * 5}${v.cnt.error ? " （下载可能遇到问题）" : ""}`);
}

const downloading_success = (resolve, index) => {
    return (oReq) => {
        v.valid_response_list[index] = oReq;
        v.cnt.done++;
        downloading_message("下载中...");
        resolve(oReq);
    }
}

const downloading_error = (reject) => {
    return (oReq) => {
        v.cnt.error++;
        downloading_message("下载中...");
        reject(oReq);
    }
}

const run_with_retry = (url, resolve, reject) => {
    let run = (retries) => {
        let oReq = new XMLHttpRequest();
        oReq.open("GET", url, true);
        oReq.responseType = "arraybuffer";
        if (c.req_timeout > 0)
            oReq.timeout = c.req_timeout;

        if(!v.captured) {
            reject(oReq);
        }

        oReq.onloadend = function (oEvent) {
            if (oReq.status === 200) {
                resolve(oReq);
            } else if (oReq.status === 429) {
                if (retries--) { // *** Recurse if we still have retries
                    console.log("Retry", retries, url);
                    run(retries);
                } else {
                    // *** Out of retries
                    reject(oReq);
                }
            } else {
                if (oReq.status !== 403)
                    console.log(oEvent);
                else
                    v.captured = false;
                reject(oReq);
            }
        };

        oReq.ontimeout = function (e) {
            console.log(e);
            reject(oReq);
        };

        oReq.send(null);
    }
    return run;
};

const segment_map = (segment_list, url_head) => {
    return segment_list.map((s, index) => new Promise((resolve, reject) => {
        index = c.index_map ? c.index_map(s) : index;
        if (v.valid_response_list[index]) {
            downloading_success(resolve)(v.valid_response_list[index]);
            return;
        }
        let run = run_with_retry(
            url_head + s,
            downloading_success(resolve, index),
            downloading_error(reject)
        );
        v.cnt.req++;
        setTimeout(() => run(10), v.cnt.req * c.req_sleeptime);
    }))
};

const onclick = (f) => {
    $('body').on('click', '#video_download', async function () {
        if (!v.captured) {
            $("#video_download").text("未获取视频源。");
            return;
        }
        if (v.downloading) {
            return;
        }
        v.downloading = true;
        v.cnt = {
            done: 0,
            error: 0,
            req: 0
        };
        downloading_message("下载中...");
        try {
            f();
        } catch (e) {
            console.log(e);
            $("#video_download").text("下载遇到错误！请尝试拖动进度条或刷新页面。");
        } finally {
            v.downloading = false;
        }
    });
};

if (window.location.href.startsWith("https://www.nicovideo.jp/")) {
    c.index_map = null;
    c.req_sleeptime = 150;
    c.req_timeout = -1;
    const template = '\
<span id="video_download">未获取视频源。</span><br/>\
<input type="checkbox" id="video_download_close_tab">\
<label for="video_download_close_tab"> 下载结束时关闭标签页</label>';
    let url_head, playlist_url_head, segment_list;
    $('.TagList').after(template);
    ah.proxy({
        //请求成功后进入
        onResponse: async (response, handler) => {
            if (response.config.url.indexOf("master.m3u8") !== -1) {
                let master_url = response.config.url;
                url_head = master_url.slice(0, master_url.lastIndexOf('/') + 1);
                let best_playlist_url = url_head + response.response.split('\n').filter(s => s && s[0] !== '#')[0];
                console.log("onResponse", response, best_playlist_url);
                let playlist_response = await $.get(best_playlist_url);
                playlist_url_head = best_playlist_url.slice(0, best_playlist_url.lastIndexOf('/') + 1);
                segment_list = playlist_response.split('\n').filter(s => s && s[0] !== '#');
                v.captured = true;
                $("#video_download").text("已获取视频源，点击下载/继续...");
            }
            handler.next(response);
        }
    });

    onclick(async () => {
        v.duration = segment_list.length * 5;
        let video_response = await Promise.allSettled(segment_map(
            segment_list,
            playlist_url_head
        ));
        // console.log(Object.keys(v.valid_response_list));
        if (video_response.some((r) => r.status == "rejected")) {
            downloading_message("下载中止，尝试点击此处或拖动视频进度条继续，或刷新页面重新下载。");
            return;
        }
        let video_upload_date = $(".VideoUploadDateMeta-dateTimeLabel").text();
        do_download(
            video_response.map(o => o.value.response),
            video_upload_date.split(' ')[0].replaceAll('/', '') + "_" + document.title + '.ts'
        );
        downloading_message("下载完成！");
    });
}

if (window.location.href.startsWith("https://live.nicovideo.jp/")) {
    c.index_map = s => +s.slice(s.lastIndexOf('/') + 1).split('.')[0];
    c.req_sleeptime = 150;
    c.req_timeout = 120000;
    const template = '\
<label for="video_save_segment_length">下载分段长度（单位：秒，请输入5的倍数，默认3600）：</label>\
<input type="text" id="video_save_segment_length"><br/>\
<label for="video_download_saved_index">下载开始位置（单位：秒，请输入5的倍数，留空默认0）：</label>\
<input type="text" id="video_download_saved_index"><br/>\
<span id="video_download">未获取视频源。</span><br/>\
<input type="checkbox" id="video_download_close_tab">\
<label for="video_download_close_tab"> 下载结束时关闭标签页</label>';
    let master_url = "";
    let saved_index = 0;
    let save_segment_length = 3600;
    $('[class^=___tag-widget___]').after(template);
    $("#video_download_saved_index").val(saved_index);
    let r = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (e) {
        if (this._datadog_xhr.url.indexOf("master.m3u8") !== -1) {
            if (!master_url || this._datadog_xhr.url.slice(0, this._datadog_xhr.url.lastIndexOf('=') + 1) !== master_url.slice(0, master_url.lastIndexOf('=') + 1)) {
                master_url = this._datadog_xhr.url;
                v.captured = true;
                if (!v.downloading) {
                    $("#video_download").text("已获取视频源，点击下载/继续...");
                }
            }
        }
        return r.apply(this, arguments);
    }
    
    onclick(async () => {
        saved_index = isFinite($("#video_download_saved_index").val()) ? +$("#video_download_saved_index").val() : saved_index;
        if (!isFinite($("#video_save_segment_length").val()) || !+$("#video_save_segment_length").val()) {
            $("#video_save_segment_length").val(save_segment_length);
        } else {
            save_segment_length = +$("#video_save_segment_length").val();
        }
        for (let curr = 0; curr < v.duration; curr += 20) {
            if (curr >= saved_index + save_segment_length) {
                let end_flag = false;
                let video_response = [];
                for (let i = saved_index; i < saved_index + save_segment_length; i += 5) {
                    let value = v.valid_response_list[i * 1000];
                    if (!value) {
                        end_flag = true;
                        break;
                    }
                    video_response.push(value);
                }
                // console.log(Object.keys(v.valid_response_list));
                if (end_flag) {
                    downloading_message("下载中止，尝试点击此处或拖动视频进度条继续，或刷新页面重新下载。");
                    return;
                }
                let video_upload_date = $('[class^=___onair-time___]').attr("datetime");
                do_download(
                    video_response.map(o => o.response),
                    video_upload_date.split(' ')[0].replaceAll('-', '') + "_" + document.title + `[${saved_index}].ts`
                );
                saved_index += save_segment_length;
                $("#video_download_saved_index").val(saved_index);
                v.valid_response_list = {};
                downloading_message(`已下载到${saved_index}，点击继续下载。`);
                return;
            }
            let end_flag = false;
            for (let i = curr; i < v.duration && i < curr + 20; i += 5) {
                if (i < saved_index || v.valid_response_list[i * 1000]) {
                    v.cnt.done++;
                } else {
                    end_flag = true;
                    break;
                }
            }
            if (!end_flag && curr) {
                //console.log("curr",curr,"already done");
                continue;
            }
            // console.log("curr", curr, "getting master");
            v.cnt.req = 0;
            let curr_url = master_url.slice(0, master_url.lastIndexOf('=') + 1) + curr;
            let master_list = await $.get(curr_url);
            let best_bandwidth = 0, best_playlist_url;
            master_list.split('\n').forEach((o, i, l) => {
                if (o.startsWith("#EXT-X-STREAM-INF")) {
                    let bandwidth = +o.split(':')[1].split(',')[0].split('=')[1];
                    if (bandwidth > best_bandwidth) {
                        best_bandwidth = bandwidth;
                        best_playlist_url = master_url.slice(0, master_url.lastIndexOf('/') + 1) + l[i + 1];
                    }
                }
            });
            let playlist_url_head = best_playlist_url.slice(0, best_playlist_url.lastIndexOf('/') + 1);
            let playlist_response = await $.get(best_playlist_url);
            playlist_response.split('\n').forEach((o) => {
                if (o.startsWith("#STREAM-DURATION")) {
                    v.duration = +o.split(':')[1];
                }
            })
            if (!end_flag) {
                continue;
            }
            let segment_list = playlist_response.split('\n').filter(s => s && s[0] !== '#');
            let video_response = await Promise.allSettled(segment_map(
                segment_list,
                playlist_url_head
            ));
        }
        let end_flag = false;
        let video_response = [];
        for (let curr = saved_index; curr < v.duration; curr += 5) {
            let value = v.valid_response_list[curr * 1000];
            if (!value) {
                end_flag = true;
                break;
            }
            video_response.push(value);
        }
        // console.log(Object.keys(v.valid_response_list));
        if (end_flag) {
            downloading_message("下载中止，尝试点击此处或拖动视频进度条继续，或刷新页面重新下载。");
            return;
        }
        let video_upload_date = $('[class^=___onair-time___]').attr("datetime");
        do_download(
            video_response.map(o => o.response),
            video_upload_date.split(' ')[0].replaceAll('-', '') + "_" + document.title + `[${saved_index}].ts`
        );
        downloading_message("下载完成！");
        saved_index = 0;
        $("#video_download_saved_index").val(saved_index);
        v.valid_response_list = {};
    });
}

if (window.location.href.startsWith("https://twitcasting.tv/")) {
    c.index_map = null;
    c.req_sleeptime = 1000;
    c.req_timeout = -1;
    const template = '\
<span id="video_download">未获取视频源。</span><br/>\
<input type="checkbox" id="video_download_close_tab">\
<label for="video_download_close_tab">下载结束时关闭标签页</label>';
    let playlist_url_head, segment_list;
    $('.tw-live-author-stat').after(template);
    ah.proxy({
        //请求成功后进入
        onResponse: async (response, handler) => {
            if (response.config.url.indexOf("index.m3u8") !== -1) {
                let master_url = response.config.url;
                playlist_url_head = master_url.slice(0, master_url.lastIndexOf('/') + 1);
                segment_list = response.response.split('\n').filter(s => s && s[0] !== '#');
                response.response.split('\n').forEach((o) => {
                    if (o.startsWith("#EXT-X-MAP:URI")) {
                        segment_list.unshift(o.split("=")[1].replaceAll('"', ''));
                    }
                });
                console.log("onResponse", response, segment_list);
                v.captured = true;
                $("#video_download").text("已获取视频源，点击下载/继续...");
            }
            handler.next(response);
        }
    });

    onclick(async () => {
        v.duration = segment_list.length * 5;
        let video_response = await Promise.allSettled(segment_map(
            segment_list,
            playlist_url_head
        ));
        // console.log(Object.keys(valid_response_list));
        if (video_response.some((r) => r.status == "rejected")) {
            downloading_message("下载中止，尝试点击此处或拖动视频进度条继续，或刷新页面重新下载。");
            return;
        }
        do_download(
            video_response.map(o => o.value.response),
            document.title + '.m4s'
        );
        downloading_message("下载完成！");
    });
}

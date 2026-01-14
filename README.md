# mkdocs 中文数字档案馆模板

功能：

- 自动整理文件名
- 对于 pdf， txt，doc 等文件通过 ai 自动生成摘要分类、下载页面
- 自动生成目录
- 自动建立 mkdocs 站点
- 生成可供检索的目录

## 目录

---

## 目录


!!! note "📊 统计信息"

    总计内容：7 篇



### 📎 其他

<table>
<thead><tr>
<th style="width: 40%" data-sortable="true" data-sort-direction="asc" data-sort-type="text">标题 ▲</th>
<th style="width: 15%" data-sortable="true" data-sort-direction="desc" data-sort-type="year">年份 ▼</th>
<th style="width: 45%">摘要</th>
</tr></thead>
<tbody>
<tr data-name="wqy-microhei" data-year="None" data-date="9999-12-31">
                <td><a href="wqy-microhei.ttc" class="md-button">wqy-microhei</a></td>
                <td class="year-cell">None</td>
                <td class="description-cell">无摘要</td>
            </tr>
</tbody>
</table>


## 📁 子目录

<table>
<thead><tr>
<th style="width: 30%" data-sortable="true" data-sort-direction="asc" data-sort-type="text">目录名 ▲</th>
<th style="width: 20%" data-sortable="true" data-sort-direction="asc" data-sort-type="text">文件数量 ▲</th>
<th style="width: 50%">简介</th>
</tr></thead>
<tbody>
<tr data-name="测试" data-count="6" data-date="0000-00-00">
                <td><a href="测试" class="md-button">测试</a></td>
                <td class="count-cell">6 篇</td>
                <td class="description-cell"><details markdown>
                    <summary>展开</summary>
                    <div class="description">
                        该目录位于路径“./测试”下，主要包含一个名为“测试.txt”的文档。从文档内容来看，文件较为简短，仅仅包含了连续重复的字符“hhhh”。表面上看，该文件似乎只是用于数字档案馆内部的测试和格式校验，但深入分析后可以发现，这种单一字符重复的现象很可能是数字采集和数据整理过程中初步录入步骤的一个示例。

文中详细描述了该文档在档案管理中的应用，暗示其作用可能包括占位符使用、暂存数据的留痕、防止检索空档或作为系统自校验的默认记录。通过对该文件研究，可以窥见数字化初期采集过程中严格的数据管理流程，反映出档案整理者对原始资料精确定录入与保存的一种态度。该文档虽然内容简略，但它在数字档案管理中体现了对数据一致性与完整性的追求。

整体来看，该目录展示的是一个测试阶段的样本文档，除了承载简单测试数据外，还揭示了档案管理过程中对每个文件细致考察的工作细节，以及在采集、整理、归档过程中的常规数据格式示例。由此可以看出，这不仅是文化与历史资料数字化工作中的一部分，同时也反映出数字档案馆对每个资料细节的关注和记录。
                        <br>文件数量：6 篇
                    </div>
                </details></td>
            </tr>
</tbody>
</table>


## 📊 词云图 { data-search-exclude }

![词云图](abstracts_wordcloud.png)


<script>
const sortFunctions = {
    year: (a, b, direction) => {
        a = a === '未知' ? '0000' : a;
        b = b === '未知' ? '0000' : b;
        return direction === 'desc' ? b.localeCompare(a) : a.localeCompare(b);
    },
    count: (a, b, direction) => {
        const aNum = parseInt(a.match(/\d+/)?.[0] || '0');
        const bNum = parseInt(b.match(/\d+/)?.[0] || '0');
        return direction === 'desc' ? bNum - aNum : aNum - bNum;
    },
    text: (a, b, direction) => {
        return direction === 'desc' 
            ? b.localeCompare(a, 'zh-CN') 
            : a.localeCompare(b, 'zh-CN');
    }
};

document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('th[data-sortable="true"]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => sortTable(th));
        
        if (th.getAttribute('data-sort-direction')) {
            sortTable(th, true);
        }
    });
});

function sortTable(th, isInitial = false) {
    const table = th.closest('table');
    const tbody = table.querySelector('tbody');
    const colIndex = Array.from(th.parentNode.children).indexOf(th);
    
    // Store original rows with their sort values
    const rowsWithValues = Array.from(tbody.querySelectorAll('tr')).map(row => ({
        element: row,
        value: row.children[colIndex].textContent.trim(),
        html: row.innerHTML
    }));
    
    // Toggle or set initial sort direction
    const currentDirection = th.getAttribute('data-sort-direction');
    const direction = isInitial ? currentDirection : (currentDirection === 'desc' ? 'asc' : 'desc');
    
    // Update sort indicators
    th.closest('tr').querySelectorAll('th').forEach(header => {
        if (header !== th) {
            header.textContent = header.textContent.replace(/ [▼▲]$/, '');
            header.removeAttribute('data-sort-direction');
        }
    });
    
    th.textContent = th.textContent.replace(/ [▼▲]$/, '') + (direction === 'desc' ? ' ▼' : ' ▲');
    th.setAttribute('data-sort-direction', direction);
    
    // Get sort function based on column type
    const sortType = th.getAttribute('data-sort-type') || 'text';
    const sortFn = sortFunctions[sortType] || sortFunctions.text;
    
    // Sort rows
    rowsWithValues.sort((a, b) => sortFn(a.value, b.value, direction));
    
    // Clear and rebuild tbody
    tbody.innerHTML = '';
    rowsWithValues.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = row.html;
        tbody.appendChild(tr);
    });
}

</script>


<div class="grid" markdown>

=== "最多访问"



=== "最近更新"

    * 9999-12-31 [wqy-microhei](wqy-microhei.ttc)
    * 2025-02-26 [test](测试/testdir/test)
    * 2025-02-26 [失落的奧德賽_千年之夢_永遠的旅人_永遠を旅する者_ロストオデッセイ_千年の夢_重松_清](测试/testdir/失落的奧德賽_千年之夢_永遠的旅人_永遠を旅する者_ロストオデッセイ_千年の夢_重松_清_page)
    * 2025-02-26 [急性氯化钡中毒致恶性心律失常、反复心脏骤停一例](测试/急性氯化钡中毒致恶性心律失常、反复心脏骤停一例_page)
    * 2025-02-26 [網文寫手古代生存錄_令狐BEYOND](测试/網文寫手古代生存錄_令狐BEYOND_page)
    * 2024-11-15 [测试](测试/测试_page)



</div>

---

## LICENSE

本项目为展示存档与资料库的模板，所有内容均来自互联网，仅供学习和研究使用。版权属于原作者。

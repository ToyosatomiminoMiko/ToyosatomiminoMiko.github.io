// JSON 渲染器组件
const JsonRenderer = {
    name: 'JsonRenderer',
    props: {
        config: {
            type: [Object, Array, String],
            required: true
        }
    },
    setup(props) {
        // 递归渲染函数
        const renderElement = (config) => {
            // 如果是字符串或数字，直接返回
            if (typeof config === 'string' || typeof config === 'number') {
                return config;
            }

            // 如果是数组，渲染每个元素
            if (Array.isArray(config)) {
                return config.map(item => renderElement(item));
            }

            // 如果是对象，渲染为 HTML 元素
            if (config && typeof config === 'object') {
                const { tag = 'div', children, text, ...attrs } = config;

                // 处理 class 属性
                if (attrs.class) {
                    attrs.class = `dynamic-element ${attrs.class}`;
                } else {
                    attrs.class = 'dynamic-element';
                }

                // 创建子元素
                let childElements = [];
                if (children) {
                    childElements = Array.isArray(children)
                        ? children.map(child => renderElement(child))
                        : renderElement(children);
                } else if (text) {
                    childElements = text;
                }

                // 使用 Vue 的 h 函数创建元素
                return Vue.h(tag, attrs, childElements);
            }

            return null;
        };

        return () => renderElement(props.config);
    }
};

// 默认 JSON 配置
const defaultJsonConfig = {
    tag: 'div',
    children: [
        {
            tag: 'h1',
            text: '欢迎使用动态元素生成器'
        },
        {
            tag: 'p',
            text: '这是一个根据 JSON 配置动态生成的页面。您可以修改左侧的 JSON 配置来更改此内容。'
        },
        {
            tag: 'div',
            class: 'card',
            children: [
                {
                    tag: 'h3',
                    text: '示例卡片'
                },
                {
                    tag: 'p',
                    text: '这是一个卡片组件，通过 JSON 配置生成。'
                },
                {
                    tag: 'a',
                    class: 'button',
                    href: '#',
                    text: '了解更多'
                }
            ]
        }
    ]
};

// 示例配置
const examples = {
    simple: {
        tag: 'div',
        children: [
            {
                tag: 'h2',
                text: '简单标题'
            },
            {
                tag: 'p',
                text: '这是一个简单的段落，用于演示 JSON 生成 HTML 元素的功能。'
            }
        ]
    },

    form: {
        tag: 'div',
        children: [
            {
                tag: 'h2',
                text: '用户注册'
            },
            {
                tag: 'div',
                class: 'form-group',
                children: [
                    {
                        tag: 'label',
                        for: 'username',
                        text: '用户名'
                    },
                    {
                        tag: 'input',
                        type: 'text',
                        id: 'username',
                        placeholder: '请输入用户名'
                    }
                ]
            },
            {
                tag: 'div',
                class: 'form-group',
                children: [
                    {
                        tag: 'label',
                        for: 'email',
                        text: '电子邮箱'
                    },
                    {
                        tag: 'input',
                        type: 'email',
                        id: 'email',
                        placeholder: '请输入邮箱地址'
                    }
                ]
            },
            {
                tag: 'div',
                class: 'form-group',
                children: [
                    {
                        tag: 'label',
                        for: 'password',
                        text: '密码'
                    },
                    {
                        tag: 'input',
                        type: 'password',
                        id: 'password',
                        placeholder: '请输入密码'
                    }
                ]
            },
            {
                tag: 'button',
                type: 'button',
                class: 'button',
                text: '提交'
            }
        ]
    },

    card: {
        tag: 'div',
        class: 'card',
        children: [
            {
                tag: 'h3',
                text: '产品卡片'
            },
            {
                tag: 'p',
                text: '这是一个产品描述，通过 JSON 配置动态生成。'
            },
            {
                tag: 'div',
                style: 'color: #e74c3c; font-weight: bold; font-size: 1.5rem;',
                text: '$29.99'
            },
            {
                tag: 'div',
                class: 'alert success',
                text: '特价优惠中！'
            }
        ]
    },

    layout: {
        tag: 'div',
        children: [
            {
                tag: 'h2',
                text: '页面布局示例'
            },
            {
                tag: 'div',
                style: 'display: flex; gap: 1rem; margin-bottom: 1rem;',
                children: [
                    {
                        tag: 'div',
                        style: 'flex: 1; background-color: #3498db; color: white; padding: 1rem; border-radius: 6px;',
                        text: '左侧栏'
                    },
                    {
                        tag: 'div',
                        style: 'flex: 2; background-color: #2ecc71; color: white; padding: 1rem; border-radius: 6px;',
                        text: '主要内容区'
                    },
                    {
                        tag: 'div',
                        style: 'flex: 1; background-color: #9b59b6; color: white; padding: 1rem; border-radius: 6px;',
                        text: '右侧栏'
                    }
                ]
            },
            {
                tag: 'div',
                style: 'background-color: #34495e; color: white; padding: 1rem; text-align: center; border-radius: 6px;',
                text: '页脚区域'
            }
        ]
    }
};

// 创建 Vue 应用
const { createApp, ref, reactive } = Vue;

createApp({
    components: {
        JsonRenderer
    },
    setup() {
        // JSON 输入
        const jsonInput = ref(JSON.stringify(defaultJsonConfig, null, 2));

        // JSON 配置
        const jsonConfig = reactive(defaultJsonConfig);

        // JSON 解析错误
        const jsonError = ref('');

        // 更新 JSON 配置
        const updateJsonConfig = () => {
            try {
                const parsed = JSON.parse(jsonInput.value);
                Object.assign(jsonConfig, parsed);
                jsonError.value = '';
            } catch (error) {
                jsonError.value = error.message;
            }
        };

        // 应用 JSON 配置
        const applyJson = () => {
            updateJsonConfig();
        };

        // 重置为默认配置
        const resetToDefault = () => {
            jsonInput.value = JSON.stringify(defaultJsonConfig, null, 2);
            Object.assign(jsonConfig, defaultJsonConfig);
            jsonError.value = '';
        };

        // 加载示例
        const loadExample = (exampleName) => {
            if (examples[exampleName]) {
                jsonInput.value = JSON.stringify(examples[exampleName], null, 2);
                Object.assign(jsonConfig, examples[exampleName]);
                jsonError.value = '';
            }
        };

        // 初始化
        updateJsonConfig();

        return {
            jsonInput,
            jsonConfig,
            jsonError,
            updateJsonConfig,
            applyJson,
            resetToDefault,
            loadExample
        };
    }
}).mount('#app');